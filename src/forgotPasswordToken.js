const mongoose = require('mongoose')
const forgotPasswordTokenSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
  },
  token: {
    type: String,
    required: true,
  },
  // Can be used only once so that's why we have this boolean
  isValid: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
})
module.exports = mongoose.model('ForgotPasswordToken', forgotPasswordTokenSchema)
