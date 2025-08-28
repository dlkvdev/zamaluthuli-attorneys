
require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const sanitizeHtml = require('sanitize-html');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const app = express();

let db;

const MongoStore = require('connect-mongo');
app.use(session({
  secret: process.env.SESSION_SECRET || 'Liwalethu@1',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI })
}));

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'file') {
      cb(null, 'public/uploads/newsletters/');
    } else if (file.fieldname === 'photo' || file.fieldname === 'additionalPhotos') {
      cb(null, 'public/uploads/events/');
    } else if (file.fieldname === 'teamPhoto') {
      cb(null, 'public/uploads/team/');
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'file' && file.mimetype === 'application/pdf') {
      cb(null, true);
    } else if ((file.fieldname === 'photo' || file.fieldname === 'additionalPhotos') && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else if (file.fieldname === 'teamPhoto' && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDFs for newsletters and images for events/team are allowed.'), false);
    }
  }
});

// Middleware
app.set('view engine', 'ejs');
app.use('/uploads', express.static('public/uploads'));
app.use('/MEDIA', express.static('public/MEDIA'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'Liwalethu@1',
  resave: false,
  saveUninitialized: false
}));
app.use(flash());
app.use(passport.initialize());
app.use(passport.session());

// Passport configuration
passport.use(new LocalStrategy(
  async (username, password, done) => {
    try {
      const user = await db.collection('users').findOne({ username });
      if (!user) {
        return done(null, false, { message: 'Incorrect username.' });
      }
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return done(null, false, { message: 'Incorrect password.' });
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await db.collection('users').findOne({ _id: new ObjectId(id) });
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Require login middleware
const requireLogin = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
};

// Connect to MongoDB
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
    console.log('MongoDB connected');
    return db;
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  }
}

// Start server and define routes
async function startServer() {
  await connectDB();

  // Root route
  app.get('/', async (req, res) => {
    try {
      const notices = await db.collection('notices').find().toArray();
      res.render('index', { notices, error: null });
    } catch (err) {
      console.error('Error fetching notices:', err);
      res.render('index', { notices: [], error: 'Failed to load notices' });
    }
  });

  // Login routes
  app.get('/login', (req, res) => {
    res.render('login', { error: req.flash('error') });
  });

  app.post('/login',
    passport.authenticate('local', {
      successRedirect: '/admin/dashboard',
      failureRedirect: '/login',
      failureFlash: true
    })
  );

  app.get('/logout', (req, res) => {
    req.logout((err) => {
      if (err) return next(err);
      res.redirect('/');
    });
  });

  // Admin dashboard route
  app.get('/admin/dashboard', requireLogin, (req, res) => {
    res.render('admin_dashboard', { user: req.user });
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
        title: 'Admin Dashboard'
      });
    }
  });

  // Admin team routes
  app.get('/admin/team', requireLogin, async (req, res) => {
    try {
      const teamMembers = await db.collection('teamMembers').find().toArray();
      console.log('Team members fetched for /admin/team:', teamMembers);
      res.render('admin_team', { teamMembers, error: null });
    } catch (err) {
      console.error('Error fetching team members:', err);
      res.render('admin_team', { teamMembers: [], error: 'Failed to load team members' });
    }
  });

  app.post('/admin/team', requireLogin, upload.single('teamPhoto'), async (req, res) => {
    const { name, position, qualifications, biography, email, contactNumber } = req.body;
    try {
      await db.collection('teamMembers').insertOne({
        name: sanitizeHtml(name),
        position: sanitizeHtml(position),
        qualifications: sanitizeHtml(qualifications),
        biography: sanitizeHtml(biography),
        email: sanitizeHtml(email),
        contactNumber: sanitizeHtml(contactNumber),
        photoPath: req.file ? `/uploads/team/${req.file.filename}` : null,
        createdAt: new Date()
      });
      res.redirect('/admin/team');
    } catch (err) {
      console.error('Error saving team member:', err);
      res.render('admin_team', {
        teamMembers: await db.collection('teamMembers').find().toArray(),
        error: 'Failed to save team member'
      });
    }
  });

  app.post('/admin/team/delete/:id', requireLogin, async (req, res) => {
    try {
      await db.collection('teamMembers').deleteOne({ _id: new ObjectId(req.params.id) });
      res.redirect('/admin/team');
    } catch (err) {
      console.error('Error deleting team member:', err);
      res.render('admin_team', {
        teamMembers: await db.collection('teamMembers').find().toArray(),
        error: 'Failed to delete team member'
      });
    }
  });

  // Privacy Policy route
  app.get('/privacy-policy', (req, res) => {
    res.render('privacy-policy', { lastUpdated: 'August 28, 2025' });
  });

  // Terms of Service route
  app.get('/terms-of-service', (req, res) => {
    res.render('terms-of-service', { lastUpdated: 'August 28, 2025' });
  });

  // Admin routes for practice areas
  app.get('/admin/practice-areas', requireLogin, async (req, res) => {
    try {
      const practiceAreas = await db.collection('practiceAreas').find().toArray();
      res.render('admin_practice_areas', { practiceAreas, error: null });
    } catch (err) {
      console.error('Error fetching practice areas:', err);
      res.render('admin_practice_areas', { practiceAreas: [], error: 'Failed to load practice areas' });
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
        error: 'Failed to save practice area'
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
      title: 'Admin Dashboard'
    });
  }
  });


  app.get('/admin/newsletters', requireLogin, async (req, res) => {
    try {
      const newsletters = await db.collection('newsletters').find().toArray();
      res.render('admin_newsletters', { newsletters, error: null });
    } catch (err) {
      console.error('Error fetching newsletters:', err);
      res.render('admin_newsletters', { newsletters: [], error: 'Failed to load newsletters' });
    }
  });

  app.post('/admin/newsletters', requireLogin, upload.single('file'), async (req, res) => {
    const { title, date } = req.body;
    console.log('Newsletter upload attempt:', { title, date, file: req.file });
    try {
      await db.collection('newsletters').insertOne({
        title: sanitizeHtml(title),
        date: date ? sanitizeHtml(date) : null,
        filePath: req.file ? `/uploads/newsletters/${req.file.filename}` : null
      });
      res.redirect('/admin/newsletters');
    } catch (err) {
      console.error('Error saving newsletter:', err);
      res.render('admin_newsletters', {
        newsletters: await db.collection('newsletters').find().toArray(),
        error: 'Failed to save newsletter. Try again.'
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
      await db.collection('newsletters').deleteOne({ _id: new ObjectId(id) });
      res.redirect('/admin/newsletters');
    } catch (err) {
      console.error('Error deleting newsletter:', err);
      res.render('admin_newsletters', {
        newsletters: await db.collection('newsletters').find().toArray(),
        error: 'Failed to delete newsletter'
      });
    }
  });

  // Contact route
  app.get('/contact', (req, res) => {
    res.render('contact', { error: null });
  });

  // Team route
  app.get('/team', async (req, res) => {
    try {
      const teamMembers = await db.collection('teamMembers').find().toArray();
      res.render('team', { teamMembers, error: null });
    } catch (err) {
      console.error('Error fetching team members:', err);
      res.render('team', { teamMembers: [], error: 'Failed to load team members' });
    }
  });

  // Attorney detail route
  app.get('/team/:id', async (req, res) => {
    try {
      const id = req.params.id;
      console.log('Request ID for /team/:id:', id);
      if (!ObjectId.isValid(id)) {
        console.log('Invalid ObjectId:', id);
        return res.render('attorney_detail', { teamMember: null, error: 'Invalid attorney ID' });
      }
      const teamMember = await db.collection('teamMembers').findOne({ _id: new ObjectId(id) });
      console.log('Found team member:', teamMember);
      if (!teamMember) {
        return res.render('attorney_detail', { teamMember: null, error: 'Attorney not found' });
      }
      res.render('attorney_detail', { teamMember, error: null });
    } catch (err) {
      console.error('Error fetching attorney:', err);
      res.render('attorney_detail', { teamMember: null, error: 'Failed to load attorney' });
    }
  });

  // Practice areas route
  app.get('/practice-areas', async (req, res) => {
    try {
      const practiceAreas = await db.collection('practiceAreas').find().toArray();
      res.render('practice_areas', { practiceAreas, error: null });
    } catch (err) {
      console.error('Error fetching practice areas:', err);
      res.render('practice_areas', { practiceAreas: [], error: 'Failed to load practice areas' });
    }
  });

  app.get('/newsletters', async (req, res) => {
    try {
      const newsletters = await db.collection('newsletters').find().toArray();
      res.render('newsletters', { newsletters, error: null });
    } catch (err) {
      console.error('Error fetching newsletters:', err);
      res.render('newsletters', { newsletters: [], error: 'Failed to load newsletters' });
    }
  });

  app.get('/admin/events', requireLogin, async (req, res) => {
    try {
      const events = await db.collection('events').find().toArray();
      res.render('admin_events', { events, error: null });
    } catch (err) {
      console.error('Error fetching events:', err);
      res.render('admin_events', { events: [], error: 'Failed to load events' });
    }
  });

  app.post('/admin/events', requireLogin, upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'additionalPhotos', maxCount: 10 }
  ]), async (req, res) => {
    const { title, date, description, photoCaptions } = req.body;
    console.log('Event upload attempt:', { title, date, description, photo: req.files.photo, additionalPhotos: req.files.additionalPhotos });
    try {
      const captionsArray = photoCaptions ? photoCaptions.split(',').map(c => c.trim()) : [];
      await db.collection('events').insertOne({
        title: sanitizeHtml(title),
        date: date ? sanitizeHtml(date) : null,
        description: sanitizeHtml(description),
        photoPath: req.files.photo ? `/uploads/events/${req.files.photo[0].filename}` : null,
        additionalPhotoPaths: req.files.additionalPhotos ? req.files.additionalPhotos.map(f => `/uploads/events/${f.filename}`) : [],
        photoCaptions: captionsArray
      });
      res.redirect('/admin/events');
    } catch (err) {
      console.error('Error saving event:', err);
      res.render('admin_events', {
        events: await db.collection('events').find().toArray(),
        error: 'Failed to save event. Try again.'
      });
    }
  });

  app.get('/events/:id', async (req, res) => {
    try {
      const id = req.params.id;
      console.log('Request ID for /events/:id:', id);
      if (!ObjectId.isValid(id)) {
        console.log('Invalid ObjectId:', id);
        return res.render('event_detail', { event: null, error: 'Invalid event ID' });
      }
      const event = await db.collection('events').findOne({ _id: new ObjectId(id) });
      console.log('Found event:', event);
      if (!event) {
        return res.render('event_detail', { event: null, error: 'Event not found' });
      }
      res.render('event_detail', { event, error: null });
    } catch (err) {
      console.error('Error fetching event:', err);
      res.render('event_detail', { event: null, error: 'Failed to load event' });
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
        if (event.photoPath) {
          const filePath = path.join(__dirname, 'public', event.photoPath);
          await fs.unlink(filePath).catch(err => console.error('Error deleting cover photo:', err));
        }
        if (event.additionalPhotoPaths && event.additionalPhotoPaths.length > 0) {
          for (const photoPath of event.additionalPhotoPaths) {
            const filePath = path.join(__dirname, 'public', photoPath);
            await fs.unlink(filePath).catch(err => console.error('Error deleting additional photo:', err));
          }
        }
      }
      await db.collection('events').deleteOne({ _id: new ObjectId(id) });
      res.redirect('/admin/events');
    } catch (err) {
      console.error('Error deleting event:', err);
      res.render('admin_events', {
        events: await db.collection('events').find().toArray(),
        error: 'Failed to delete event'
      });
    }
  });



  app.get('/events', async (req, res) => {
    try {
      const events = await db.collection('events').find().toArray();
      res.render('events', { events, error: null });
    } catch (err) {
      console.error('Error fetching events:', err);
      res.render('events', { events: [], error: 'Failed to load events' });
    }
  });

  app.get('/admin/notices', requireLogin, async (req, res) => {
    try {
      const notices = await db.collection('notices').find().toArray();
      res.render('admin_notices', { notices, error: null });
    } catch (err) {
      console.error('Error fetching notices:', err);
      res.render('admin_notices', { notices: [], error: 'Failed to load notices' });
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
        error: 'Failed to save notice'
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
        error: 'Failed to delete notice'
      });
    }
  });


  // Start server
  const PORT = process.env.PORT || 10000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(console.error);
