const bcrypt = require('bcryptjs');
const newPassword = 'Knoxnavis10'; // Replace with your desired password
bcrypt.hash(newPassword, 10, (err, hash) => {
  if (err) throw err;
  console.log('Hashed password:', hash);
});