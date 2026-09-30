const mongoose = require('mongoose');
const User = require('./src/models/User');
const bcrypt = require('bcryptjs');

mongoose.connect('mongodb://localhost:27017/steel-dms').then(async () => {
  const user = await User.findOne().select('-password_hash');
  if (user) {
    console.log('User found');
    user.password_hash = 'NewPassword123';
    console.log('isModified:', user.isModified('password_hash'));
    await user.save();
    console.log('Updated user password');
  }
  
  const savedUser = await User.findOne({ _id: user._id }).select('+password_hash');
  const match = await bcrypt.compare('NewPassword123', savedUser.password_hash);
  console.log('Match NewPassword123:', match);
  process.exit(0);
});
