
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
    } else if (file.fieldname === 'photo') {
      cb(null, 'public/uploads/events/');
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
    } else if (file.fieldname === 'photo' && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDFs for newsletters and images for events are allowed.'), false);
    }
  }
});

// Middleware
app.set('view engine', 'ejs');
app.use('/uploads', express.static('public/uploads'));
app.use('/MEDIA', express.static('public/MEDIA')); // Serve carousel images
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
    const user = await db.collection('users').findOne({ _id: ObjectId(id) });
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
      successRedirect: '/admin/practice-areas',
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

  // Admin routes
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
        id: Date.now(),
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

  app.post('/admin/events', requireLogin, upload.single('photo'), async (req, res) => {
    const { title, date, description } = req.body;
    console.log('Event upload attempt:', { title, date, description, photo: req.file });
    try {
      await db.collection('events').insertOne({
        id: Date.now(),
        title: sanitizeHtml(title),
        date: date ? sanitizeHtml(date) : null,
        description: sanitizeHtml(description),
        photoPath: req.file ? `/uploads/events/${req.file.filename}` : null
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

  app.get('/events', async (req, res) => {
    try {
      const events = await db.collection('events').find().toArray();
      res.render('events', { events, error: null });
    } catch (err) {
      console.error('Error fetching events:', err);
      res.render('events', { events: [], error: 'Failed to load events' });
    }
  });

  // Start server
  const PORT = process.env.PORT || 10000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(console.error);
