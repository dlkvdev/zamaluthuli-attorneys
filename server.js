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

// Middleware
app.set('view engine', 'ejs');
app.use('/uploads', express.static('public/uploads'));
app.use('/MEDIA', express.static('public/MEDIA')); // Serve carousel images
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

async function startServer() {
  await connectDB();

  // Root route
  app.get('/', async (req, res) => {
    try {
      const notices = await db.collection('notices').find().toArray();
      res.render('index', { notices });
    } catch (err) {
      console.error('Error fetching notices:', err);
      res.render('index', { notices: [], error: 'Failed to load notices' });
    }
  });

  // Add your other routes here (e.g., /login, /admin/newsletters)
  app.get('/login', (req, res) => {
    res.render('login', { error: null });
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

  // Example: Newsletter route
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

  // Start server
  const PORT = process.env.PORT || 10000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(console.error);