const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB for seeding'))
  .catch(err => console.error('MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
  username: String,
  password: String
});
const User = mongoose.model('User', userSchema);

const attorneySchema = new mongoose.Schema({
  name: String,
  position: String,
  qualifications: String,
  bio: String,
  photo: String,
  email: String,
  contact_number: String
});
const Attorney = mongoose.model('Attorney', attorneySchema);

const practiceAreaSchema = new mongoose.Schema({
  title: String,
  description: String
});
const PracticeArea = mongoose.model('PracticeArea', practiceAreaSchema);

const newsletterSchema = new mongoose.Schema({
  title: String,
  file: String,
  createdAt: { type: Date, default: Date.now }
});
const Newsletter = mongoose.model('Newsletter', newsletterSchema);

const eventSchema = new mongoose.Schema({
  title: String,
  event_date: Date,
  description: String,
  image: String,
  images: [{ url: String, caption: String }]
});
const Event = mongoose.model('Event', eventSchema);

async function seedDB() {
  await User.deleteMany({});
  await Attorney.deleteMany({});
  await PracticeArea.deleteMany({});
  await Newsletter.deleteMany({});
  await Event.deleteMany({});

  const hashedPassword = await bcrypt.hash('admin123', 10);
  const users = [
    { username: 'admin', password: hashedPassword }
  ];

  const attorneys = [
    {
      name: 'John Doe',
      position: 'Senior Attorney',
      qualifications: 'LLB, University of Pretoria',
      bio: 'John has over 15 years of experience in corporate law.',
      photo: '/MEDIA/Attorneys/attorney1.jpg',
      email: 'john.doe@zamaluthuliattorneys.com',
      contact_number: '+27 31 007 6258'
    },
    {
      name: 'Jane Smith',
      position: 'Associate Attorney',
      qualifications: 'LLB, University of Cape Town',
      bio: 'Jane specializes in family law and mediation.',
      photo: '/MEDIA/Attorneys/attorney2.jpg',
      email: 'jane.smith@zamaluthuliattorneys.com',
      contact_number: '+27 31 007 6259'
    }
  ];

  const practiceAreas = [
    {
      title: 'Corporate Law',
      description: 'Providing expert legal advice for businesses and corporate entities.'
    },
    {
      title: 'Family Law',
      description: 'Comprehensive legal support for family-related matters including divorce and custody.'
    }
  ];

  const newsletters = [
    {
      title: 'Quarterly Legal Update Q1 2025',
      file: '/MEDIA/Newsletters/newsletter1.pdf',
      createdAt: new Date('2025-01-15')
    }
  ];

  const events = [
    {
      title: 'Legal Workshop 2025',
      event_date: new Date('2025-03-10'),
      description: 'Join us for an insightful workshop on corporate law trends.',
      image: '/MEDIA/Events/event1.jpg',
      images: [
        { url: '/MEDIA/Events/event1_photo1.jpg', caption: 'Workshop attendees' },
        { url: '/MEDIA/Events/event1_photo2.jpg', caption: 'Guest speaker' }
      ]
    }
  ];

  await User.insertMany(users);
  await Attorney.insertMany(attorneys);
  await PracticeArea.insertMany(practiceAreas);
  await Newsletter.insertMany(newsletters);
  await Event.insertMany(events);
  console.log('Database seeded');
  mongoose.connection.close();
}

seedDB();