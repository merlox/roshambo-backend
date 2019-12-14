require('dotenv-safe').config()

const { FORGOT_PASSWORD_DOMAIN } = process.env
const express = require('express')
const bodyParser = require('body-parser')
const limiter = require('express-rate-limit')
const path = require('path')
const app = express()
const jwt = require('jsonwebtoken')
const User = require('./src/user')
const ForgotPasswordToken = require('./src/forgotPasswordToken')
const setup = require('./src/setup')
const bcrypt = require('bcrypt')
const yargs = require('yargs')
const sendEmail = require('./src/sendEmail')
const argv = yargs.option('port', {
    alias: 'p',
    description: 'Set the port to run this server on',
    type: 'number',
}).help().alias('help', 'h').argv
if(!argv.port) {
    console.log('Error, you need to pass the port you want to run this application on with npm start -- -p 8001')
    process.exit(0)
}
const port = argv.port

// This is to simplify everything but you should set it from the terminal
// required to encrypt user accounts
process.env.SALT = 'express'

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended: true}))
app.use('*', (req, res, next) => {
	// Logger
	let time = new Date()
	console.log(`${req.method} to ${req.originalUrl} at ${time.getHours()}:${time.getMinutes()}:${time.getSeconds()}`)
	next()
})

// To register a new user
app.post('/user', async (req, res) => {
	try {
		let foundUser = await User.findOne({email: req.body.email})
		// If we found a user, return a message indicating that the user already exists
		if(foundUser) {
			return res.status(400).json({
				ok: false,
				message: 'The user already exists, login or try again',
			})
		} else {
      if (req.body.password.length < 6) {
        return res.status(400).json({
  				ok: false,
  				message: 'The password must be at least 6 characters',
  			})
      }
			let newUser = new User({
				email: req.body.email,
				password: req.body.password,
        username: req.body.username,
			})
			newUser.save(err => {
				if(err) {
					return res.status(400).json({
						ok: false,
						message: 'There was an error saving the new user, try again',
					})
				}
				// Create the JWT token based on that new user
				const token = jwt.sign({userId: newUser.id}, process.env.SALT)
				// If the user was added successful, return the user credentials
				return res.status(200).json({
					ok: true,
          message: 'User created successfully',
					token,
				})
			})
		}
	} catch(err) {
		return res.status(400).json({
			ok: false,
			message: 'There was an error processing your request, try again',
		})
	}
})

// To update a user's password
app.put('/user', async (req, res) => {
  if (!req.body.email || !req.body.password || !req.body.token) {
    return res.status(400).json({
      ok: false,
      msg: 'There was an error making the request',
    })
  }
  if (req.body.password.length < 6) {
    return res.status(400).json({
      ok: false,
      msg: 'The password must be at least 6 characters',
    })
  }
  try {
    // Find the token email combo
    const forgotPasswordTokenFound = await ForgotPasswordToken.findOne({
      email: req.body.email,
      token: req.body.token,
    })
    let foundUser = await User.findOne({email: req.body.email})
    if (!foundUser) {
      return res.status(400).json({
        ok: false,
        msg: 'The user email is not registered',
      })
    }
    if (!forgotPasswordTokenFound) {
      return res.status(400).json({
        ok: false,
        msg: 'Could not find that user reset token',
      })
    } else if (!forgotPasswordTokenFound.isValid) {
      return res.status(400).json({
        ok: false,
        msg: 'This password recovery token has already been used, request a new one',
      })
    } else {
      forgotPasswordTokenFound.isValid = false
      await forgotPasswordTokenFound.save()
    }
    // Here's the actual password update
    foundUser.password = req.body.password
    await foundUser.save()
    res.status(200).json({
      ok: true,
      msg: 'User updated successfully'
    })
  } catch (e) {
    return res.status(400).json({
      ok: false,
      msg: 'There was an error processing the request',
    })
  }
})

// To login with an existing user
/*
	1. Check if user already exists
	2. If not, return a message saying user not found
	3. If found, generate the JWT token and send it
*/
app.post('/user/login', async (req, res) => {
	try {
		let foundUser = await User.findOne({email: req.body.email})
		if(foundUser) {
			foundUser.comparePassword(req.body.password, (isMatch) => {
				if(!isMatch) {
					return res.status(400).json({
						ok: false,
						message: 'User found but the password is invalid',
					})
				} else {
					const token = jwt.sign({userId: foundUser._id}, process.env.SALT)
					return res.status(200).json({
						ok: true,
            message: 'User logged in successfully',
            token,
					})
				}
			})
		} else {
			return res.status(400).json({
				ok: false,
				message: 'User not found',
			})
		}
	} catch(err) {
		return res.status(400).json({
			ok: false,
			message: 'Invalid password or email',
		})
	}
})

app.post('/forgot-password', limiter({
  windowMs: 10 * 60 * 1000, // One every 10 minutes if blocked
  max: 10, // Start limiting after 10 requests
  message: "You're making too many requests to this endpoint",
}), async (req, res) => {
  // Find if the email received exists or not
  try {
    const foundUser = await User.findOne({
      email: req.body.email,
    })
    if (!foundUser) {
      return res.status(400).json({
        ok: false,
        msg: 'The email address is not registered',
      })
    }
  } catch (e) {
    return res.status(400).json({
      ok: false,
      msg: 'There was an error checking the user email address'
    })
  }
  const token = String(Math.ceil(Math.random() * 1e16))
  const recoveryLink = `${FORGOT_PASSWORD_DOMAIN}forgot-password/${token}/${req.body.email}`
  // Store token in the db
  const tokenSave = new ForgotPasswordToken({
    email: req.body.email,
    token,
  })
  tokenSave.save(async err => {
    if (err) {
      return res.status(400).json({
        ok: false,
        message: 'There was an error saving the recovery token, try again',
      })
    }
    try {
      // Send email
      await sendEmail(req.body.email, 'Reset your account password', `If you're receiving this message is because you've clicked on 'I forgot my password' on the login page. Here's your recovery link: ${recoveryLink}`)
      res.status(200).json({
        ok: true,
        msg: 'The password reset email has been sent successfully, please click on the link to reset your password'
      })
    } catch (e) {
      res.status(400).json({
        ok: false,
        msg: 'There was an error sending your recovery email, try again in a moment'
      })
    }
  })
})

// The endpoint called when clicking on the recovery password email
app.get('/forgot-password/:token/:email', limiter({
  windowMs: 10 * 60 * 1000, // One every 10 minutes if blocked
  max: 10, // Start limiting after 10 requests
  message: "You're making too many requests to this endpoint",
}), async (req, res) => {
  // First check that the token is valid, and if it is, show him the setup new password page
  try {
    const foundToken = await ForgotPasswordToken.findOne({
      email: req.params.email,
      token: req.params.token,
    })
    if (!foundToken) {
      return res.status(400).json({
        ok: false,
        msg: `The token is invalid, try again`,
      })
    } else {
      // Redirects to the usual page but in react it will display the right form
      res.redirect(`/reset-password-form?email=${req.params.email}&token=${req.params.token}`)
    }
  } catch (e) {
    return res.status(400).json({
      ok: false,
      msg: `Couldn't check your password recovery url, try to generate a new one`,
    })
  }
})

app.listen(port, '0.0.0.0', (req, res) => {
	console.log(`Listening on localhost:${port}`)
})

function protectRoute(req, res, next) {
	if (req.user) next()
	else res.status(401).json({error: 'You must be logged to access this page'})
}
