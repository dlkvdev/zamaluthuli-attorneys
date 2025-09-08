require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId, GridFSBucket } = require('mongodb');
const sanitizeHtml = require('sanitize-html');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const MongoStore = require('connect-mongo');
const nodemailer = require('nodemailer');
const axios = require('axios');
const app = express();

let db;
let bucket; // GridFS bucket for file storage

// Multer setup for file uploads (memory storage for GridFS)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Nodemailer setup with debug logging
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  debug: true, // Enable debug output
  logger: true // Log to console
});

// Middleware
app.set('view engine', 'ejs');
app.use('/Uploads', express.static('public/uploads'));
app.use('/MEDIA', express.static('public/MEDIA'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'Liwalethu@1',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ 
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60 // 24 hours
  }),
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    secure: false // Temporary for debugging
  }
}));
app.use((req, res, next) => {
  console.log('Session initialized:', req.session);
  next();
});
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

// Multer error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Multer error:', err.message, 'Field:', err.field);
    res.render(req.path.includes('/admin/events') ? 'admin_events' : 'admin', {
      events: [],
      error: `Multer error: ${err.message}${err.field ? ` (Field: ${err.field})` : ''}`,
      success: null
    });
  } else {
    next(err);
  }
});

// Passport configuration
passport.use(new LocalStrategy(
  async (username, password, done) => {
    try {
      console.log('Attempting login with username:', username);
      const user = await db.collection('users').findOne({ username });
      console.log('User found:', user);
      if (!user) {
        console.log('Login failed: Incorrect username');
        return done(null, false, { message: 'Incorrect username.' });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      console.log('Password match:', isMatch);
      if (!isMatch) {
        console.log('Login failed: Incorrect password');
        return done(null, false, { message: 'Incorrect password.' });
      }
      console.log('Login successful for user:', username);
      return done(null, user);
    } catch (err) {
      console.error('Authentication error:', err);
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => {
  console.log('Serializing user:', user._id);
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await db.collection('users').findOne({ _id: new ObjectId(id) });
    console.log('Deserialized user:', user);
    done(null, user);
  } catch (err) {
    console.error('Deserialization error:', err);
    done(err);
  }
});

// Require login middleware
const requireLogin = (req, res, next) => {
  console.log('Checking authentication:', req.isAuthenticated());
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
};

// Connect to MongoDB and initialize GridFS
async function connectDB() {
  const uri = process.env.MONGODB_URI;
  console.log('MONGODB_URI:', uri);
  if (!uri) {
    console.error('MONGODB_URI is not defined');
    process.exit(1);
  }
  try {
    const client = new MongoClient(uri, {
      tls: true,
      tlsInsecure: false,
      serverSelectionTimeoutMS: 5000,
      heartbeatFrequencyMS: 10000,
    });
    await client.connect();
    db = client.db('attorneys');
    bucket = new GridFSBucket(db, { bucketName: 'uploads' });
    console.log('MongoDB connected with GridFS');
    return db;
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  }
}

// File download route for GridFS
app.get('/file/:id', async (req, res) => {
  try {
    const fileId = req.params.id;
    console.log('Attempting to download file with ID:', fileId);
    if (!ObjectId.isValid(fileId)) {
      console.log('Invalid ObjectId:', fileId);
      return res.status(400).send('Invalid file ID');
    }
    const downloadStream = bucket.openDownloadStream(new ObjectId(fileId));
    downloadStream.on('file', (file) => {
      console.log('Found file in GridFS:', file.filename);
      res.set('Content-Type', file.contentType);
      const disposition = file.contentType.startsWith('image/') ? 'inline' : 'attachment';
      res.set('Content-Disposition', `${disposition}; filename="${file.filename}"`);
    });
    downloadStream.on('error', (err) => {
      console.error('GridFS download error:', err);
      res.status(404).send('File not found');
    });
    downloadStream.pipe(res);
  } catch (err) {
    console.error('Error downloading file:', err);
    res.status(500).send('Error downloading file');
  }
});

// Test flash route
app.get('/test-flash', (req, res) => {
  console.log('Testing flash message');
  req.flash('error', 'Test flash message');
  res.redirect('/login');
});

// Contact form submission route
app.post('/contact', async (req, res) => {
  const { name, email, message, 'g-recaptcha-response': recaptchaResponse } = req.body;
  console.log('Contact form submission:', { name, email, message, recaptchaResponse });
  try {
    // Verify reCAPTCHA
    const recaptchaVerification = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
      params: {
        secret: process.env.RECAPTCHA_SECRET_KEY,
        response: recaptchaResponse
      }
    });
    if (!recaptchaVerification.data.success) {
      throw new Error('reCAPTCHA verification failed');
    }

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: 'admin@zluthuliattorneys.co.za',
      replyTo: email,
      subject: `New Contact Form Submission from ${name}`,
      text: `Name: ${sanitizeHtml(name)}\nEmail: ${sanitizeHtml(email)}\nMessage: ${sanitizeHtml(message)}`
    };
    await transporter.sendMail(mailOptions);
    console.log('Contact email sent successfully');
    req.flash('success', 'Your message has been sent successfully!');
    res.redirect('/contact');
  } catch (err) {
    console.error('Error sending contact email:', err);
    req.flash('error', err.message === 'reCAPTCHA verification failed' ? 'Please complete the reCAPTCHA verification.' : 'Failed to send message. Please try again.');
    res.redirect('/contact');
  }
});

// Start server and define routes
async function startServer() {
  await connectDB();

  // Root route
  app.get('/', async (req, res) => {
    try {
      const notices = await db.collection('notices').find().toArray();
      res.render('index', { notices, error: null, success: null });
    } catch (err) {
      console.error('Error fetching notices:', err);
      res.render('index', { notices: [], error: 'Failed to load notices', success: null });
    }
  });

  // Login routes
  app.get('/login', (req, res) => {
    const error = req.flash('error');
    console.log('Rendering login page with flash error:', error);
    res.render('login', { error, success: null });
  });

  app.post('/login', (req, res, next) => {
    console.log('Received login request:', req.body);
    passport.authenticate('local', {
      successRedirect: '/admin/dashboard',
      failureRedirect: '/login',
      failureFlash: true
    })(req, res, next);
  });

  app.get('/logout', (req, res) => {
    req.logout((err) => {
      if (err) return next(err);
      res.redirect('/');
    });
  });

  // Admin dashboard route
  app.get('/admin/dashboard', requireLogin, (req, res) => {
    console.log('Accessing admin dashboard for user:', req.user);
    res.render('admin_dashboard', { user: req.user, success: null });
  });

  // Admin panel route
  app.get('/admin', requireLogin, async (req, res) => {
    try {
      const teamMembers = await db.collection('teamMembers').find().toArray();
      const practiceAreas = await db.collection('practiceAreas').find().toArray();
      const newsletters = await db.collection('newsletters').find().toArray();
      const events = await db.collection('events').find().toArray();
      res.render('admin', {
        teamMembers,
        practiceAreas,
        newsletters,
        events,
        error: null,
        success: null,
        title: 'Admin Dashboard'
      });
    } catch (err) {
      console.error('Error fetching admin data:', err);
      res.render('admin', {
        teamMembers: [],
        practiceAreas: [],
        newsletters: [],
        events: [],
        error: 'Failed to load admin data',
        success: null,
        title: 'Admin Dashboard'
      });
    }
  });

  // Admin team routes
  app.get('/admin/team', requireLogin, async (req, res) => {
    try {
      const teamMembers = await db.collection('teamMembers').find().toArray();
      const success = req.flash('success') || null;
      console.log('Team members fetched for /admin/team:', teamMembers);
      res.render('admin_team', { teamMembers, error: null, success });
    } catch (err) {
      console.error('Error fetching team members:', err);
      res.render('admin_team', { teamMembers: [], error: 'Failed to load team members', success: null });
    }
  });

  app.post('/admin/team', requireLogin, upload.single('teamPhoto'), async (req, res) => {
    const { name, position, qualifications, biography, email, contactNumber } = req.body;
    try {
      let photoId = null;
      if (req.file) {
        const uploadStream = bucket.openUploadStream(req.file.originalname, {
          contentType: req.file.mimetype
        });
        await new Promise((resolve, reject) => {
          uploadStream.end(req.file.buffer, (err) => {
            if (err) reject(err);
            else {
              photoId = uploadStream.id;
              resolve();
            }
          });
        });
      }
      await db.collection('teamMembers').insertOne({
        name: sanitizeHtml(name),
        position: sanitizeHtml(position),
        qualifications: sanitizeHtml(qualifications),
        biography: sanitizeHtml(biography),
        email: sanitizeHtml(email),
        contactNumber: sanitizeHtml(contactNumber),
        photoId: photoId ? photoId.toString() : null,
        createdAt: new Date()
      });
      req.flash('success', 'Team member added successfully!');
      res.redirect('/admin/team');
    } catch (err) {
      console.error('Error saving team member:', err);
      res.render('admin_team', {
        teamMembers: await db.collection('teamMembers').find().toArray(),
        error: 'Failed to save team member',
        success: null
      });
    }
  });

  app.post('/admin/team/delete/:id', requireLogin, async (req, res) => {
    try {
      const teamMember = await db.collection('teamMembers').findOne({ _id: new ObjectId(req.params.id) });
      if (teamMember && teamMember.photoId && ObjectId.isValid(teamMember.photoId)) {
        await bucket.delete(new ObjectId(teamMember.photoId));
      }
      await db.collection('teamMembers').deleteOne({ _id: new ObjectId(req.params.id) });
      req.flash('success', 'Team member deleted successfully!');
      res.redirect('/admin/team');
    } catch (err) {
      console.error('Error deleting team member:', err);
      res.render('admin_team', {
        teamMembers: await db.collection('teamMembers').find().toArray(),
        error: 'Failed to delete team member',
        success: null
      });
    }
  });

  // Edit team member form
  app.get('/admin/team/edit/:id', requireLogin, async (req, res) => {
    try {
      const teamMember = await db.collection('teamMembers').findOne({ _id: new ObjectId(req.params.id) });
      if (!teamMember) {
        const teamMembers = await db.collection('teamMembers').find().toArray();
        return res.render('admin_team', { teamMembers, error: 'Team member not found', success: null });
      }
      const success = req.flash('success') || null;
      res.render('admin_team_edit', { teamMember, error: null, success });
    } catch (err) {
      console.error('Error fetching team member for edit:', err);
      const teamMembers = await db.collection('teamMembers').find().toArray();
      res.render('admin_team', { teamMembers, error: 'Failed to load edit form', success: null });
    }
  });

  // Update team member
  app.post('/admin/team/edit/:id', requireLogin, upload.single('teamPhoto'), async (req, res) => {
    const { name, position, qualifications, biography, email, contactNumber } = req.body;
    const id = req.params.id;
    try {
      let photoId;
      const existingMember = await db.collection('teamMembers').findOne({ _id: new ObjectId(id) });
      if (!existingMember) {
        throw new Error('Team member not found');
      }

      if (req.file) {
        const uploadStream = bucket.openUploadStream(req.file.originalname, {
          contentType: req.file.mimetype
        });
        await new Promise((resolve, reject) => {
          uploadStream.end(req.file.buffer, (err) => {
            if (err) reject(err);
            else {
              photoId = uploadStream.id.toString();
              resolve();
            }
          });
        });
        if (existingMember.photoId && ObjectId.isValid(existingMember.photoId)) {
          await bucket.delete(new ObjectId(existingMember.photoId));
        }
      } else {
        photoId = existingMember.photoId;
      }

      await db.collection('teamMembers').updateOne({ _id: new ObjectId(id) }, {
        $set: {
          name: sanitizeHtml(name),
          position: sanitizeHtml(position),
          qualifications: sanitizeHtml(qualifications),
          biography: sanitizeHtml(biography),
          email: sanitizeHtml(email),
          contactNumber: sanitizeHtml(contactNumber),
          photoId,
          updatedAt: new Date()
        }
      });
      req.flash('success', 'Team member updated successfully!');
      res.redirect('/admin/team');
    } catch (err) {
      console.error('Error updating team member:', err);
      res.render('admin_team_edit', { teamMember: { _id: id, ...req.body }, error: 'Failed to update team member', success: null });
    }
  });

  // Privacy Policy route
  app.get('/privacy-policy', (req, res) => {
    res.render('privacy-policy', { lastUpdated: 'August 28, 2025', success: null });
  });

  // Terms of Service route
  app.get('/terms-of-service', (req, res) => {
    res.render('terms-of-service', { lastUpdated: 'August 28, 2025', success: null });
  });

  // Admin routes for practice areas
  app.get('/admin/practice-areas', requireLogin, async (req, res) => {
    try {
      const practiceAreas = await db.collection('practiceAreas').find().toArray();
      res.render('admin_practice_areas', { practiceAreas, error: null, success: null });
    } catch (err) {
      console.error('Error fetching practice areas:', err);
      res.render('admin_practice_areas', { practiceAreas: [], error: 'Failed to load practice areas', success: null });
    }
  });

  app.post('/admin/practice-areas', requireLogin, async (req, res) => {
    const { title, description } = req.body;
    try {
      await db.collection('practiceAreas').insertOne({
        title: sanitizeHtml(title),
        description: sanitizeHtml(description),
        createdAt: new Date()
      });
      res.redirect('/admin/practice-areas');
    } catch (err) {
      console.error('Error saving practice area:', err);
      res.render('admin_practice_areas', {
        practiceAreas: await db.collection('practiceAreas').find().toArray(),
        error: 'Failed to save practice area',
        success: null
      });
    }
  });

  app.post('/admin/practice-areas/delete/:id', requireLogin, async (req, res) => {
    try {
      await db.collection('practiceAreas').deleteOne({ _id: new ObjectId(req.params.id) });
      res.redirect('/admin');
    } catch (err) {
      console.error('Error deleting practice area:', err);
      res.render('admin', {
        teamMembers: await db.collection('teamMembers').find().toArray(),
        practiceAreas: await db.collection('practiceAreas').find().toArray(),
        newsletters: await db.collection('newsletters').find().toArray(),
        events: await db.collection('events').find().toArray(),
        error: 'Failed to delete practice area',
        success: null,
        title: 'Admin Dashboard'
      });
    }
  });

  app.get('/admin/newsletters', requireLogin, async (req, res) => {
    try {
      const newsletters = await db.collection('newsletters').find().toArray();
      res.render('admin_newsletters', { newsletters, error: null, success: null });
    } catch (err) {
      console.error('Error fetching newsletters:', err);
      res.render('admin_newsletters', { newsletters: [], error: 'Failed to load newsletters', success: null });
    }
  });

  app.post('/admin/newsletters', requireLogin, upload.single('file'), async (req, res) => {
    const { title, date } = req.body;
    console.log('Newsletter upload attempt:', { title, date, file: req.file ? req.file.originalname : null });
    try {
      let fileId = null;
      if (req.file) {
        const uploadStream = bucket.openUploadStream(req.file.originalname, {
          contentType: req.file.mimetype
        });
        await new Promise((resolve, reject) => {
          uploadStream.end(req.file.buffer, (err) => {
            if (err) reject(err);
            else {
              fileId = uploadStream.id;
              console.log('Uploaded file with ID:', fileId.toString());
              resolve();
            }
          });
        });
      }
      await db.collection('newsletters').insertOne({
        title: sanitizeHtml(title),
        date: date ? sanitizeHtml(date) : null,
        fileId: fileId ? fileId.toString() : null
      });
      console.log('Saved newsletter with fileId:', fileId ? fileId.toString() : null);
      res.redirect('/admin/newsletters');
    } catch (err) {
      console.error('Error saving newsletter:', err);
      res.render('admin_newsletters', {
        newsletters: await db.collection('newsletters').find().toArray(),
        error: 'Failed to save newsletter. Try again.',
        success: null
      });
    }
  });

  app.post('/admin/newsletters/delete/:id', requireLogin, async (req, res) => {
    try {
      const id = req.params.id;
      console.log('Delete newsletter request URL:', req.originalUrl);
      if (!ObjectId.isValid(id)) {
        throw new Error('Invalid newsletter ID');
      }
      const newsletter = await db.collection('newsletters').findOne({ _id: new ObjectId(id) });
      if (newsletter && newsletter.fileId && ObjectId.isValid(newsletter.fileId)) {
        await bucket.delete(new ObjectId(newsletter.fileId));
      }
      await db.collection('newsletters').deleteOne({ _id: new ObjectId(id) });
      res.redirect('/admin/newsletters');
    } catch (err) {
      console.error('Error deleting newsletter:', err);
      res.render('admin_newsletters', {
        newsletters: await db.collection('newsletters').find().toArray(),
        error: 'Failed to delete newsletter',
        success: null
      });
    }
  });

  // Contact route
  app.get('/contact', (req, res) => {
    const error = req.flash('error') || null;
    const success = req.flash('success') || null;
    res.render('contact', { error, success });
  });

  // Team route
  app.get('/team', async (req, res) => {
    try {
      const teamMembers = await db.collection('teamMembers').find().toArray();
      res.render('team', { teamMembers, error: null, success: null });
    } catch (err) {
      console.error('Error fetching team members:', err);
      res.render('team', { teamMembers: [], error: 'Failed to load team members', success: null });
    }
  });

  // Attorney detail route
  app.get('/team/:id', async (req, res) => {
    try {
      const id = req.params.id;
      console.log('Request ID for /team/:id:', id);
      if (!ObjectId.isValid(id)) {
        console.log('Invalid ObjectId:', id);
        return res.render('attorney_detail', { teamMember: null, error: 'Invalid attorney ID', success: null });
      }
      const teamMember = await db.collection('teamMembers').findOne({ _id: new ObjectId(id) });
      console.log('Found team member:', teamMember);
      if (!teamMember) {
        return res.render('attorney_detail', { teamMember: null, error: 'Attorney not found', success: null });
      }
      res.render('attorney_detail', { teamMember, error: null, success: null });
    } catch (err) {
      console.error('Error fetching attorney:', err);
      res.render('attorney_detail', { teamMember: null, error: 'Failed to load attorney', success: null });
    }
  });

  // Practice areas route
  app.get('/practice-areas', async (req, res) => {
    try {
      const practiceAreas = await db.collection('practiceAreas').find().toArray();
      res.render('practice_areas', { practiceAreas, error: null, success: null });
    } catch (err) {
      console.error('Error fetching practice areas:', err);
      res.render('practice_areas', { practiceAreas: [], error: 'Failed to load practice areas', success: null });
    }
  });

  app.get('/newsletters', async (req, res) => {
    try {
      const newsletters = await db.collection('newsletters').find().toArray();
      console.log('Newsletters fetched for /newsletters:', newsletters.map(n => ({ title: n.title, fileId: n.fileId })));
      res.render('newsletters', { newsletters, error: null, success: null });
    } catch (err) {
      console.error('Error fetching newsletters:', err);
      res.render('newsletters', { newsletters: [], error: 'Failed to load newsletters', success: null });
    }
  });

  app.get('/admin/events', requireLogin, async (req, res) => {
    try {
      const events = await db.collection('events').find().toArray();
      console.log('Events fetched for /admin/events:', events.map(e => ({ title: e.title, photoId: e.photoId, additionalPhotoIds: e.additionalPhotoIds })));
      res.render('admin_events', { events, error: null, success: null });
    } catch (err) {
      console.error('Error fetching events:', err);
      res.render('admin_events', { events: [], error: 'Failed to load events', success: null });
    }
  });

  app.post('/admin/events', requireLogin, upload.any(), async (req, res) => {
    const { title, date, description, photoCaptions } = req.body;
    console.log('Event upload attempt:', {
      title,
      date,
      description,
      photo: req.files.find(f => f.fieldname === 'photo') ? req.files.find(f => f.fieldname === 'photo').originalname : null,
      additionalPhotos: req.files.filter(f => f.fieldname === 'additionalPhotos').map(f => f.originalname),
      receivedFields: Object.keys(req.body).concat(req.files.map(f => f.fieldname))
    });
    try {
      let photoId = null;
      let additionalPhotoIds = [];
      const captionsArray = photoCaptions ? photoCaptions.split(',').map(c => c.trim()) : [];

      const photoFile = req.files.find(f => f.fieldname === 'photo');
      if (photoFile) {
        const uploadStream = bucket.openUploadStream(photoFile.originalname, {
          contentType: photoFile.mimetype
        });
        await new Promise((resolve, reject) => {
          uploadStream.end(photoFile.buffer, (err) => {
            if (err) reject(err);
            else {
              photoId = uploadStream.id;
              console.log('Uploaded cover photo with ID:', photoId.toString());
              resolve();
            }
          });
        });
      }

      const additionalPhotos = req.files.filter(f => f.fieldname === 'additionalPhotos');
      if (additionalPhotos.length > 0) {
        for (const file of additionalPhotos) {
          const uploadStream = bucket.openUploadStream(file.originalname, {
            contentType: file.mimetype
          });
          await new Promise((resolve, reject) => {
            uploadStream.end(file.buffer, (err) => {
              if (err) reject(err);
              else {
                const photoIdStr = uploadStream.id.toString();
                additionalPhotoIds.push(photoIdStr);
                console.log('Uploaded additional photo with ID:', photoIdStr);
                resolve();
              }
            });
          });
        }
      }

      await db.collection('events').insertOne({
        title: sanitizeHtml(title),
        date: date ? sanitizeHtml(date) : null,
        description: sanitizeHtml(description),
        photoId: photoId ? photoId.toString() : null,
        additionalPhotoIds: additionalPhotoIds,
        photoCaptions: captionsArray
      });
      console.log('Saved event with photoId:', photoId ? photoId.toString() : null, 'additionalPhotoIds:', additionalPhotoIds);
      res.redirect('/admin/events');
    } catch (err) {
      console.error('Error saving event:', err);
      res.render('admin_events', {
        events: await db.collection('events').find().toArray(),
        error: 'Failed to save event. Try again.',
        success: null
      });
    }
  });

  app.get('/events/:id', async (req, res) => {
    try {
      const id = req.params.id;
      console.log('Request ID for /events/:id:', id);
      if (!ObjectId.isValid(id)) {
        console.log('Invalid ObjectId:', id);
        return res.render('event_detail', { event: null, error: 'Invalid event ID', success: null });
      }
      const event = await db.collection('events').findOne({ _id: new ObjectId(id) });
      console.log('Found event:', event);
      if (!event) {
        return res.render('event_detail', { event: null, error: 'Event not found', success: null });
      }
      res.render('event_detail', { event, error: null, success: null });
    } catch (err) {
      console.error('Error fetching event:', err);
      res.render('event_detail', { event: null, error: 'Failed to load event', success: null });
    }
  });

  app.post('/admin/events/delete/:id', requireLogin, async (req, res) => {
    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) {
        throw new Error('Invalid event ID');
      }
      const event = await db.collection('events').findOne({ _id: new ObjectId(id) });
      if (event) {
        if (event.photoId && ObjectId.isValid(event.photoId)) {
          await bucket.delete(new ObjectId(event.photoId));
        }
        if (event.additionalPhotoIds && event.additionalPhotoIds.length > 0) {
          for (const photoId of event.additionalPhotoIds) {
            if (ObjectId.isValid(photoId)) {
              await bucket.delete(new ObjectId(photoId));
            }
          }
        }
      }
      await db.collection('events').deleteOne({ _id: new ObjectId(id) });
      res.redirect('/admin/events');
    } catch (err) {
      console.error('Error deleting event:', err);
      res.render('admin_events', {
        events: await db.collection('events').find().toArray(),
        error: 'Failed to delete event',
        success: null
      });
    }
  });

  app.get('/events', async (req, res) => {
    try {
      const events = await db.collection('events').find().toArray();
      console.log('Events fetched for /events:', events.map(e => ({ title: e.title, photoId: e.photoId, additionalPhotoIds: e.additionalPhotoIds })));
      res.render('events', { events, error: null, success: null });
    } catch (err) {
      console.error('Error fetching events:', err);
      res.render('events', { events: [], error: 'Failed to load events', success: null });
    }
  });

  app.get('/admin/notices', requireLogin, async (req, res) => {
    try {
      const notices = await db.collection('notices').find().toArray();
      res.render('admin_notices', { notices, error: null, success: null });
    } catch (err) {
      console.error('Error fetching notices:', err);
      res.render('admin_notices', { notices: [], error: 'Failed to load notices', success: null });
    }
  });

  app.post('/admin/notices', requireLogin, async (req, res) => {
    const { title, content, date } = req.body;
    try {
      await db.collection('notices').insertOne({
        title: sanitizeHtml(title),
        content: sanitizeHtml(content),
        date: date ? sanitizeHtml(date) : null,
        createdAt: new Date()
      });
      res.redirect('/admin/notices');
    } catch (err) {
      console.error('Error saving notice:', err);
      res.render('admin_notices', {
        notices: await db.collection('notices').find().toArray(),
        error: 'Failed to save notice',
        success: null
      });
    }
  });

  app.post('/admin/notices/delete/:id', requireLogin, async (req, res) => {
    try {
      await db.collection('notices').deleteOne({ _id: new ObjectId(req.params.id) });
      res.redirect('/admin/notices');
    } catch (err) {
      console.error('Error deleting notice:', err);
      res.render('admin_notices', {
        notices: await db.collection('notices').find().toArray(),
        error: 'Failed to delete notice',
        success: null
      });
    }
  });

  // Start server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(console.error);