const bcrypt = require('bcryptjs');
const password = 'Knoxnavis&2020';
const hashedPassword = bcrypt.hashSync(password, 10);
console.log('Hashed Password:', hashedPassword);