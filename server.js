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

   app.set('view engine', 'ejs');
   app.use('/uploads', express.static('public/uploads')); // Serves public/css/styles.css, public/uploads/, etc.
   app.use(express.urlencoded({ extended: true }));

   // Session middleware
   app.use(session({
     secret: 'your-secret-key', // Replace with a strong secret in production
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
       const uploadPath = path.join('public', 'uploads', subfolder);
       await ensureDir(uploadPath);
       cb(null, uploadPath);
     },
     filename: (req, file, cb) => {
       cb(null, Date.now() + '-' + file.originalname);
     },
   });
   const upload = multer({
     storage,
     fileFilter: (req, file, cb) => {
       const allowedTypes = {
         '/admin/newsletters': ['application/pdf'],
         '/admin/team': ['image/jpeg', 'image/png', 'image/gif'],
         '/admin/practice-areas': ['image/jpeg', 'image/png', 'image/gif'],
         '/admin/events': ['image/jpeg', 'image/png', 'image/gif']
       }[req.path];
       if (allowedTypes && !allowedTypes.includes(file.mimetype)) {
         return cb(new Error(`Invalid file type. Expected ${allowedTypes.join(' or ')}`));
       }
       cb(null, true);
     },
     limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
   });

   // MongoDB connection
   const mongoUrl = 'mongodb://localhost:27017';
   const dbName = 'attorneys';
   let db;

   MongoClient.connect(mongoUrl, { useUnifiedTopology: true })
     .then(client => {
       console.log('Connected to MongoDB');
       db = client.db(dbName);
       app.listen(3000, () => console.log('Server running on port 3000'));
     })
     .catch(err => {
       console.error('Failed to connect to MongoDB:', err);
       process.exit(1);
     });

   // Login routes
   app.get('/login', (req, res) => {
     res.render('login', { error: req.query.error || null });
   });

   app.post('/login', passport.authenticate('local', {
     successRedirect: '/admin',
     failureRedirect: '/login?error=Invalid%20credentials'
   }));

   // Logout route
   app.get('/logout', (req, res, next) => {
     req.logout(function(err) {
       if (err) { return next(err); }
       res.redirect('/login');
     });
   });

   // Admin dashboard route
   app.get('/admin', requireLogin, (req, res) => {
     res.render('admin_dashboard');
   });

   // Home
   app.get('/', async (req, res) => {
     try {
       const notices = await db.collection('notices').find().toArray();
       console.log('Notices fetched for home:', notices);
       res.render('index', { notices });
     } catch (err) {
       console.error('Error fetching notices:', err);
       res.render('index', { notices: [] });
     }
   });

   // Events
   app.get('/events', async (req, res) => {
     try {
       const events = await db.collection('events').find().toArray();
       console.log('Events fetched:', events);
       res.render('events', { events });
     } catch (err) {
       console.error('Error fetching events:', err);
       res.render('events', { events: [] });
     }
   });

   // Event Detail
   app.get('/events/:id', async (req, res) => {
     try {
       const event = await db.collection('events').findOne({ id: parseInt(req.params.id) });
       console.log('Event detail fetched:', event);
       res.render('event_detail', { event });
     } catch (err) {
       console.error('Error fetching event:', err);
       res.render('event_detail', { event: null });
     }
   });

   // Practice Areas
   app.get('/practice-areas', async (req, res) => {
     try {
       const practiceAreas = await db.collection('practice_areas').find().toArray();
       console.log('Practice areas fetched:', practiceAreas);
       res.render('practice_areas', { practiceAreas });
     } catch (err) {
       console.error('Error fetching practice areas:', err);
       res.render('practice_areas', { practiceAreas: [] });
     }
   });

   // Practice Area Detail
   app.get('/practice-areas/:id', async (req, res) => {
     try {
       const practiceArea = await db.collection('practice_areas').findOne({ id: parseInt(req.params.id) });
       console.log('Practice area detail fetched:', practiceArea);
       res.render('practice_area_detail', { practiceArea });
     } catch (err) {
       console.error('Error fetching practice area:', err);
       res.render('practice_area_detail', { practiceArea: null });
     }
   });

   // Newsletters
   app.get('/newsletters', async (req, res) => {
     try {
       const newsletters = await db.collection('newsletters').find().toArray();
       console.log('Newsletters fetched:', newsletters);
       res.render('newsletters', { newsletters });
     } catch (err) {
       console.error('Error fetching newsletters:', err);
       res.render('newsletters', { newsletters: [] });
     }
   });

   // Team
   app.get('/team', async (req, res) => {
     try {
       const teamMembers = await db.collection('team').find().toArray();
       console.log('Team members fetched:', teamMembers);
       res.render('team', { teamMembers });
     } catch (err) {
       console.error('Error fetching team:', err);
       res.render('team', { teamMembers: [] });
     }
   });

   // Contact page
   app.get('/contact', (req, res) => {
     res.render('contact', { success: req.query.success || null, error: req.query.error || null });
   });

   // Attorney Detail
   app.get('/team/:id', async (req, res) => {
     try {
       const attorney = await db.collection('team').findOne({ id: parseInt(req.params.id) });
       console.log('Attorney detail fetched:', attorney);
       res.render('attorney_detail', { attorney });
     } catch (err) {
       console.error('Error fetching attorney:', err);
       res.render('attorney_detail', { attorney: null });
     }
   });

   // Admin Notices
   app.get('/admin/notices', requireLogin, async (req, res) => {
     try {
       const notices = await db.collection('notices').find().toArray();
       console.log('Admin notices fetched:', notices);
       res.render('admin_notices', { notices });
     } catch (err) {
       console.error('Error fetching notices:', err);
       res.render('admin_notices', { notices: [], error: 'Failed to load notices' });
     }
   });

   // Admin Events
   app.get('/admin/events', requireLogin, async (req, res) => {
     try {
       const events = await db.collection('events').find().toArray();
       console.log('Admin events fetched:', events);
       res.render('admin_events', { events, error: null });
     } catch (err) {
       console.error('Error fetching events:', err);
       res.render('admin_events', { events: [], error: 'Failed to load events' });
     }
   });

   app.post('/admin/events', requireLogin, upload.fields([
     { name: 'coverPhoto', maxCount: 1 },
     { name: 'additionalPhotos', maxCount: 10 }
   ]), async (req, res) => {
     const { title, date, description, captions } = req.body;
     console.log('Event upload attempt:', { title, date, description, files: req.files });
     try {
       const coverPhoto = req.files['coverPhoto'] ? `/uploads/events/cover/${req.files['coverPhoto'][0].filename}` : null;
       const additionalPhotos = req.files['additionalPhotos'] ? req.files['additionalPhotos'].map(file => ({
         path: `/uploads/events/gallery/${file.filename}`,
         caption: '' // Will be updated below
       })) : [];
       const captionArray = captions ? captions.split(',').map(c => c.trim()) : [];
       additionalPhotos.forEach((photo, index) => {
         photo.caption = captionArray[index] || '';
       });

       await db.collection('events').insertOne({
         id: Date.now(),
         title: sanitizeHtml(title),
         date: date ? sanitizeHtml(date) : null,
         description: sanitizeHtml(description),
         coverPhotoPath: coverPhoto,
         gallery: additionalPhotos
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

   app.post('/admin/events/delete/:id', requireLogin, async (req, res) => {
     try {
       const event = await db.collection('events').findOne({ id: parseInt(req.params.id) });
       if (event) {
         if (event.coverPhotoPath) {
           await fs.unlink(path.join(__dirname, 'public', event.coverPhotoPath.replace('/uploads', 'uploads'))).catch(err => console.error('Error deleting cover photo:', err));
         }
         if (event.gallery && event.gallery.length > 0) {
           for (const photo of event.gallery) {
             await fs.unlink(path.join(__dirname, 'public', photo.path.replace('/uploads', 'uploads'))).catch(err => console.error('Error deleting gallery photo:', err));
           }
         }
       }
       await db.collection('events').deleteOne({ id: parseInt(req.params.id) });
       res.redirect('/admin/events');
     } catch (err) {
       console.error('Error deleting event:', err);
       res.render('admin_events', {
         events: await db.collection('events').find().toArray(),
         error: 'Failed to delete event'
       });
     }
   });

   // Admin Team
   app.get('/admin/team', requireLogin, async (req, res) => {
     try {
       const team = await db.collection('team').find().toArray();
       console.log('Admin team fetched:', team);
       res.render('admin_team', { team, error: null });
     } catch (err) {
       console.error('Error fetching team:', err);
       res.render('admin_team', { team: [], error: 'Failed to load team members' });
     }
   });

   app.post('/admin/team', requireLogin, upload.single('photo'), async (req, res) => {
     const { name, position, bio } = req.body;
     console.log('Team upload attempt:', { name, position, bio, photo: req.file });
     try {
       await db.collection('team').insertOne({
         id: Date.now(),
         name: sanitizeHtml(name),
         position: sanitizeHtml(position),
         bio: sanitizeHtml(bio),
         photoPath: req.file ? `/uploads/attorneys/${req.file.filename}` : null
       });
       res.redirect('/admin/team');
     } catch (err) {
       console.error('Error saving team member:', err);
       res.render('admin_team', {
         team: await db.collection('team').find().toArray(),
         error: 'Failed to save team member. Try again.'
       });
     }
   });

   app.post('/admin/team/delete/:id', requireLogin, async (req, res) => {
     try {
       const member = await db.collection('team').findOne({ id: parseInt(req.params.id) });
       if (member && member.photoPath) {
         await fs.unlink(path.join(__dirname, 'public', member.photoPath.replace('/uploads', 'uploads'))).catch(err => console.error('Error deleting file:', err));
       }
       await db.collection('team').deleteOne({ id: parseInt(req.params.id) });
       res.redirect('/admin/team');
     } catch (err) {
       console.error('Error deleting team member:', err);
       res.render('admin_team', {
         team: await db.collection('team').find().toArray(),
         error: 'Failed to delete team member'
       });
     }
   });

   // Admin Practice Areas
   app.get('/admin/practice-areas', requireLogin, async (req, res) => {
     try {
       const practiceAreas = await db.collection('practice_areas').find().toArray();
       console.log('Admin practice areas fetched:', practiceAreas);
       res.render('admin_practice_areas', { practiceAreas, error: null });
     } catch (err) {
       console.error('Error fetching practice areas:', err);
       res.render('admin_practice_areas', { practiceAreas: [], error: 'Failed to load practice areas' });
     }
   });

   app.post('/admin/practice-areas', requireLogin, upload.single('image'), async (req, res) => {
     const { title, description } = req.body;
     console.log('Practice area upload attempt:', { title, description, image: req.file });
     try {
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