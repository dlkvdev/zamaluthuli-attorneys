const express = require('express');
const { MongoClient } = require('mongodb');
const sanitizeHtml = require('sanitize-html');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs');
const app = express();

let db;

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  console.log('MONGODB_URI:', uri); // Debug log
  if (!uri) {
    console.error('MONGODB_URI is not defined');
    process.exit(1);
  }
  try {
    const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();
    db = client.db('attorneys'); // Use the 'attorneys' database from your URI
    console.log('MongoDB connected');
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  }
}

connectDB().catch(console.error);

app.set('view engine', 'ejs');
app.use('/uploads', express.static('public/uploads')); // Serves public/css/styles.css, public/uploads/, etc.
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key', // Use environment variable
  resave: false,
  saveUninitialized: true,
}));

// Passport setup
app.use(passport.initialize());
app.use(passport.session());

passport.use(new LocalStrategy({
  usernameField: 'email', // Matches the 'email' field in login form
  passwordField: 'password'
}, async (email, password, done) => {
  console.log('Auth attempt:', { email });
  try {
    if (!db) throw new Error('Database not initialized');
    const user = await db.collection('users').findOne({ email });
    console.log('User found:', user);
    if (!user) {
      return done(null, false, { message: 'Incorrect email' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('Password match:', isMatch);
    if (!isMatch) {
      return done(null, false, { message: 'Incorrect password' });
    }
    return done(null, user);
  } catch (err) {
    console.error('Auth error:', err);
    return done(err);
  }
}));

passport.serializeUser((user, done) => {
  done(null, user.id); // Assuming id is a number from Date.now()
});

passport.deserializeUser(async (id, done) => {
  try {
    if (!db) throw new Error('Database not initialized');
    const user = await db.collection('users').findOne({ id: parseInt(id) });
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Middleware to protect admin routes
const requireLogin = (req, res, next) => {
  if (req.isAuthenticated()) {
    next();
  } else {
    res.redirect('/login');
  }
};

// Ensure upload subfolders exist
const ensureDir = async (dir) => {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    console.error(`Error creating directory ${dir}:`, err);
  }
};

// Multer setup for file uploads with route-specific subfolders
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    let subfolder;
    if (req.path === '/admin/newsletters') {
      subfolder = 'newsletters';
    } else if (req.path === '/admin/team') {
      subfolder = 'attorneys';
    } else if (req.path === '/admin/practice-areas') {
      subfolder = 'practice-areas';
    } else if (req.path === '/admin/events') {
      subfolder = file.fieldname === 'coverPhoto' ? 'events/cover' : 'events/gallery';
    } else {
      return cb(new Error('Invalid upload route'));
    }
    const uploadPath = path.join(__dirname, 'public', 'uploads', subfolder);
    await ensureDir(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Routes...

// Admin Practice Areas
app.get('/admin/practice-areas', requireLogin, async (req, res) => {
  try {
    if (!db) throw new Error('Database not initialized');
    const practiceAreas = await db.collection('practice_areas').find().toArray();
    res.render('admin_practice_areas', { practiceAreas, error: null });
  } catch (err) {
    console.error('Error fetching practice areas:', err);
    res.render('admin_practice_areas', { practiceAreas: [], error: 'Failed to load practice areas' });
  }
});

app.post('/admin/practice-areas', requireLogin, upload.single('image'), async (req, res) => {
  const { title, description } = req.body;
  try {
    if (!db) throw new Error('Database not initialized');
    await db.collection('practice_areas').insertOne({
      id: Date.now(),
      title: sanitizeHtml(title),
      description: sanitizeHtml(description),
      imagePath: req.file ? `/uploads/practice-areas/${req.file.filename}` : null
    });
    res.redirect('/admin/practice-areas');
  } catch (err) {
    console.error('Error saving practice area:', err);
    res.render('admin_practice_areas', {
      practiceAreas: await db.collection('practice_areas').find().toArray(),
      error: 'Failed to save practice area. Try again.'
    });
  }
});

app.post('/admin/practice-areas/delete/:id', requireLogin, async (req, res) => {
  try {
    if (!db) throw new Error('Database not initialized');
    const area = await db.collection('practice_areas').findOne({ id: parseInt(req.params.id) });
    if (area && area.imagePath) {
      await fs.unlink(path.join(__dirname, 'public', area.imagePath.replace('/uploads', 'uploads'))).catch(err => console.error('Error deleting file:', err));
    }
    await db.collection('practice_areas').deleteOne({ id: parseInt(req.params.id) });
    res.redirect('/admin/practice-areas');
  } catch (err) {
    console.error('Error deleting practice area:', err);
    res.render('admin_practice_areas', {
      practiceAreas: await db.collection('practice_areas').find().toArray(),
      error: 'Failed to delete practice area'
    });
  }
});

// Admin Newsletters
app.get('/admin/newsletters', requireLogin, async (req, res) => {
  try {
    if (!db) throw new Error('Database not initialized');
    const newsletters = await db.collection('newsletters').find().toArray();
    console.log('Admin newsletters fetched:', newsletters);
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
    if (!db) throw new Error('Database not initialized');
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

app.post('/admin/newsletters/delete/:id', requireLogin, async (req, res) => {
  try {
    if (!db) throw new Error('Database not initialized');
    const newsletter = await db.collection('newsletters').findOne({ id: parseInt(req.params.id) });
    if (newsletter && newsletter.filePath) {
      await fs.unlink(path.join(__dirname, 'public', newsletter.filePath.replace('/uploads', 'uploads'))).catch(err => console.error('Error deleting file:', err));
    }
    await db.collection('newsletters').deleteOne({ id: parseInt(req.params.id) });
    res.redirect('/admin/newsletters');
  } catch (err) {
    console.error('Error deleting newsletter:', err);
    res.render('admin_newsletters', {
      newsletters: await db.collection('newsletters').find().toArray(),
      error: 'Failed to delete newsletter'
    });
  }
});

// Routes for Privacy Policy and Terms of Service
app.get('/privacy-policy', (req, res) => {
  res.render('privacy-policy');
});

app.get('/terms-of-service', (req, res) => {
  res.render('terms-of-service');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});