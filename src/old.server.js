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
const Game = require('./src/game')
const bcrypt = require('bcrypt')
const yargs = require('yargs')
const sendEmail = require('./src/sendEmail')
const mongoose = require('mongoose')
const session = require('express-session')
const MongoStore = require('connect-mongo')(session)
const bip39 = require('bip39')
const TronAddress = require('@bitsler/tron-address')
const TronGrid = require('trongrid')
const TronWeb = require('tronweb')
const http = require('http').createServer(app)
const io = require('socket.io')(http)

// TODO Change the fullhost to mainnet: https://api.trongrid.io
// Instead of testnet: https://api.shasta.trongrid.io
const tronWeb = new TronWeb({
  fullHost: 'https://api.shasta.trongrid.io',
})
const tronGrid = new TronGrid(tronWeb)

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
process.env.SALT = 'example-merlox120'
mongoose.connect('mongodb://localhost:27017/roshambo', {
	useNewUrlParser: true,
	useCreateIndex: true,
})
mongoose.connection.on('error', err => {
	console.log('Error connecting to the database', err)
})
mongoose.connection.once('open', function() {
  console.log('Opened database connection')
})
app.use(session({
  secret: process.env.SALT,
  resave: true,
  unset: 'destroy',
  saveUninitialized: true,
  store: new MongoStore({mongooseConnection: mongoose.connection}),
  cookie: {
    // Un año
    maxAge: 1000 * 60 * 60 * 24 * 365,
  },
}))

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({extended: true}))
app.use('*', (req, res, next) => {
	// Logger
	let time = new Date()
	console.log(`${req.method} to ${req.originalUrl} at ${time.getHours()}:${time.getMinutes()}:${time.getSeconds()}`)
	next()
})

const err = (res, msg) => {
  return res.status(400).json({
    ok: false,
    msg,
  })
}

// To register a new user
app.post('/user', async (req, res) => {
	try {
		let foundUser = await User.findOne({email: req.body.email})
		// If we found a user, return a message indicating that the user already exists
		if(foundUser) {
      return err('The user already exists, login or try again')
		} else {
      if (req.body.password.length < 6) {
        return err('The password must be at least 6 characters')
      }
      const mnemonic = bip39.generateMnemonic()
			let newUser = new User({
				email: req.body.email,
				password: req.body.password,
        username: req.body.username,
        mnemonic,
			})

      try {
			  await newUser.save()
      } catch (e) {
        console.log('Error saving the new user', e)
        return err('Error saving the new user')
      }
      const userId = newUser._id;
      const userAddress = new TronAddress(foundUser.mnemonic, 0)
      const balance = (await tronGrid.account.get(userAddress)).data[0].balance
      req.session.user = {
				email: req.body.email,
        username: req.body.username,
        userId,
        userAddress,
        balance,
			}
      req.session.save()

			// If the user was added successful, return the user credentials
			return res.status(200).json({
				ok: true,
        msg: 'User created successfully',
				userId,
        userAddress,
        balance,
			})
		}
	} catch(err) {
		return res.status(400).json({
			ok: false,
			msg: 'There was an error processing your request, try again',
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
			foundUser.comparePassword(req.body.password, async isMatch => {
				if(!isMatch) {
					return res.status(400).json({
						ok: false,
						msg: 'User found but the password is invalid',
					})
				} else {
          const userId = foundUser._id;
          const userAddress = new TronAddress(foundUser.mnemonic, 0)
          let balance = (await tronGrid.account.get(userAddress)).data[0].balance

          req.session.user = {
    				email: req.body.email,
            username: foundUser.username,
            userId,
            userAddress,
            balance,
    			}
          req.session.save()

					return res.status(200).json({
						ok: true,
            msg: 'User logged in successfully',
            userId,
            userAddress,
            balance,
					})
				}
			})
		} else {
			return res.status(400).json({
				ok: false,
				msg: 'User not found',
			})
		}
	} catch(err) {
		return res.status(400).json({
			ok: false,
			msg: 'Invalid password or email',
		})
	}
})

// Login or register with crypto if no account is found after a valid mnemonic
// Checks if a user with mnemonic exists
// If not, it creates a new one and returns the user id in both cases
// We can't encrypt the mnemonic because users won't be able to login without it
app.post('/user/login-with-crypto', async (req, res) => {
  const error = msg => {
    return res.status(400).json({
      ok: false,
      msg,
    })
  }
	try {
    if (!req.body.mnemonic || req.body.mnemonic.length == 0) {
      return error("Mnemonic not received")
    }
    if (req.body.mnemonic.split(' ').length != 12) {
      return error("The mnemonic received must be 12 words")
    }
    req.body.mnemonic = req.body.mnemonic.trim()
		let foundUser = await User.findOne({mnemonic: req.body.mnemonic})
    let userId

    // Existing account, login
		if (foundUser) {
      // Log in for that found user
      userId = foundUser._id;
		} else {
      // New account, register
      let newUser = new User({
        mnemonic: req.body.mnemonic,
      })
      try {
        await newUser.save()
      } catch (e) {
        console.log("Error saving new mnemonic user", e)
        return error("Error saving your new account")
      }
      userId = newUser._id;
		}

    const userAddress = (new TronAddress(req.body.mnemonic, 0)).master
    console.log('User address', userAddress)
    const balance = (await tronGrid.account.get(userAddress)).data[0].balance
    console.log('Balance', balance)

    req.session.user = {
      userId,
      userAddress,
      balance,
    }
    req.session.save()
    return res.status(200).json({
      ok: true,
      msg: 'User logged in successfully',
      userId,
      userAddress,
      balance,
    })
	} catch (e) {
    console.log("Error processing the request", e)
    return error("Error processing the request on the server")
	}
})

app.get('/user/logout', async (req, res) => {
  // Delete connected user game
  await Game.findOneAndRemove({userId: req.session.user.userId})
  req.session.destroy()
  return res.status(200).json({
    ok: true,
    msg: 'Logged out successfully',
  })
})

// Create a new game
app.post('/game', protectRoute, limiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: "You're making too many requests to this endpoint",
}), async (req, res) => {
  const error = msg => {
    return res.status(400).json({
      ok: false,
      msg,
    })
  }
  if (!req.body.gameName || req.body.gameName.length <= 0) {
    return error('You need to specify the game name')
  }
  if (!req.body.gameType || req.body.gameType.length <= 0) {
    return error('You need to specify the game type')
  }
  if (!req.body.rounds || req.body.rounds.length <= 0) {
    return error('You need to specify the rounds for that game')
  }
  if (!req.body.moveTimer || req.body.moveTimer.length <= 0) {
    return error('You need to specify the move timer')
  }
  if (req.body.gameType != 'Rounds' && req.body.gameType != 'All cards') {
    return error('The round type is invalid')
  }
  // Users can only have 1 game per person
  const existingGame = await Game.findOne({userId: req.session.user.userId})
  if (existingGame) {
    return error('You can only create one game per user')
  } else {
    const gameObject = {
      userId: req.session.user.userId,
      gameName: req.body.gameName,
      gameType: req.body.gameType,
      rounds: req.body.rounds,
      moveTimer: req.body.moveTimer,
    }
    let newGame = new Game(gameObject)
    try {
      await newGame.save()
      return res.status(200).json({
        ok: true,
        msg: 'The game has been created successfully',
      })
    } catch (e) {
      console.log('Error creating the game', e)
      return error('Error creating the game try again')
    }
  }
})

// Get all the games
app.get('/games', async (req, res) => {
  try {
    const games = await Game.find({})
    return res.status(200).json(games)
  } catch (e) {
    return err('Error processing the request on the server')
  }
})

app.delete('/games/:userId', protectRoute, limiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: "You're making too many requests to this endpoint",
}), async (req, res) => {
  if (!req.params.userId || req.params.userId.length == 0) {
    return err('The user id is missing make sure you are logged in')
  }
  try {
    // Returns NULL if not found or deleted already otherwise it returns the item
    // in either case we don't case so we return the same success message
    await Game.findOneAndRemove({userId: req.params.userId})
    return res.status(200).json({
      ok: true,
      msg: 'The game has been deleted successfully',
    })
  } catch (e) {
    return err('Error processing the request on the server')
  }
})

let socketIds = []
let socketGames = [] // Each game contains the game object including the socketId
io.on('connection', socket => {
  console.log('User connected', socket.id)
  socketIds.push(socket.id)
  socket.on('disconnect', async () => {
    console.log('User disconnected', socket.id)
    // Delete the disconnected user games
    // await Game.findOneAndRemove({userId: req.session.user.userId})
    // req.session.destroy()
    const index = socketIds.indexOf(socket.id)
    const gameExistingIndex = socketGames.map(game => game.playerOne).indexOf(socket.id)
    socketIds.splice(index, 1) // Delete 1
    if (gameExistingIndex != -1) {
      socketGames.splice(gameExistingIndex, 1)
    }
  })
  socket.on('game:create', async data => {
    const error = msg => {
      return socket.emit('error', { msg })
    }
    if (!data.gameName || data.gameName.length <= 0) {
      return error('You need to specify the game name')
    }
    if (!data.gameType || data.gameType.length <= 0) {
      return error('You need to specify the game type')
    }
    if (!data.rounds || data.rounds.length <= 0) {
      return error('You need to specify the rounds for that game')
    }
    if (!data.moveTimer || data.moveTimer.length <= 0) {
      return error('You need to specify the move timer')
    }
    if (data.gameType != 'Rounds' && data.gameType != 'All cards') {
      return error('The round type is invalid')
    }

    const gameObject = {
      playerOne: socket.id,
      playerTwo: null,
      gameName: data.gameName,
      gameType: data.gameType,
      rounds: data.rounds,
      moveTimer: data.moveTimer,
    }
    const gameExisting = socketGames.map(game => game.playerOne).find(playerOne => playerOne == socket.id)
    if (gameExisting) {
      return socket.emit('error', {
        msg: 'You can only create one game per user',
      })
    }
    socketGames.push(gameObject)
    socket.emit('game:create-complete', {
      msg: 'The game has been created successfully',
    })
  })
  socket.on('game:get-games', () => {
    socket.emit('game:get-games', {
      msg: socketGames,
    })
  })
  socket.on('game:join', async data => {
    // Setup the user id on my game
    let game
    try {
      game = await Game.findOne({userId: data.userId})
      if (!game) {
        return socket.emit('error', {
          msg: "That game couldn't be found",
        })
      }
      game.enemyUserId = req.session.user.userId
      await game.save()
    } catch (e) {
      return socket.emit('error', {
        msg: "Error processing the join request",
      })
    }
    // Emit event to inform the other user
    io.emit('game:join-complete', {
      playerOne: data.userId,
      playerTwo: req.session.user.userId,
    })
  })
})

http.listen(port, '0.0.0.0')
console.log(`Listening on localhost:${port}`)

function protectRoute(req, res, next) {
  console.log('--- Calling protected route... ---')
	if (req.session.user) {
    console.log('--- Access granted --- to', req.session.user.userId)
    next()
	} else {
    return res.status(401).json({
      ok: false,
      msg: 'You must be logged to do that action',
    })
  }
}
