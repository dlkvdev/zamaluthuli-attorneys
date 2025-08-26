const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://zla:knoxnavis@cluster0.fe61ycp.mongodb.net/attorneys?retryWrites=true&w=majority');
const User = mongoose.model('User', new mongoose.Schema({ username: String, password: String }));
async function createUser() {
  const hashedPassword = await bcrypt.hash('testpassword', 10);
  await User.create({ username: 'admin', password: hashedPassword });
  console.log('User created');
  mongoose.connection.close();
}
createUser();