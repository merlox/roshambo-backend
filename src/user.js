const mongoose = require('mongoose')
const bcrypt = require('bcrypt')

// The hidden _id is the userId
const userSchema = new mongoose.Schema({
  email: String,
  password: String,
  username: String,
  mnemonic: String,
  cards: [Map], // An array of objects containing the card type and token ID
}, {
  timestamps: true,
})

// Before creating a new user, encrypt the password
userSchema.pre('save', async function(next) {
  const user = this
  try {
    // In case you're creating an account with just the mnemonic
    if (user.password) {
      const hashedPassword = await bcrypt.hash(user.password, 10)
      user.password = hashedPassword
    }
    next()
  } catch(err) {
    next(err)
  }
})

userSchema.methods.comparePassword = function(candidatePassword, cb) {
  bcrypt.compare(candidatePassword, this.password, (err, isMatch) => {
    if (err) return cb(false)
    cb(isMatch)
  })
}

const User = mongoose.model('User', userSchema)
module.exports = User
