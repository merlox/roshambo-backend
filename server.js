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
  fullNode: 'https://api.shasta.trongrid.io',
  solidityNode: 'https://api.shasta.trongrid.io',
  eventServer: 'https://api.shasta.trongrid.io',
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

let socketIds = []
let socketGames = [] // Each game contains the game object including the socketId

// This is to simplify everything but you should set it from the terminal
// required to encrypt user accounts
process.env.SALT = 'example-merlox120'
mongoose.set('useNewUrlParser', true)
mongoose.set('useFindAndModify', false)
mongoose.set('useCreateIndex', true)
mongoose.set('useUnifiedTopology', true)
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

io.on('connection', socket => {
  console.log('User connected', socket.id)
  socketIds.push(socket.id)
  // Logging middleware
  socket.use((package, next) => {
    console.log('GET', package[0])
    next()
  })
  socket.on('disconnect', async () => {
    console.log('User disconnected', socket.id)
    const index = socketIds.indexOf(socket.id)
    const gameExistingIndex = socketGames.map(game => game.playerOne).indexOf(socket.id)
    socketIds.splice(index, 1) // Delete 1
    if (gameExistingIndex != -1) {
      socketGames.splice(gameExistingIndex, 1)
    }
    try {
      await Game.findOneAndRemove({playerOne: socket.id})
    } catch (e) {
      console.log('Error', e)
      console.log('Error deleting socket games from the database:', socket.id)
    }
  })
  socket.on('game:create', async data => {
    const issue = msg => {
      return socket.emit('issue', { msg })
    }
    if (!data.gameName || data.gameName.length <= 0) {
      return issue('You need to specify the game name')
    }
    if (!data.gameType || data.gameType.length <= 0) {
      return issue('You need to specify the game type')
    }
    if (!data.rounds || data.rounds.length <= 0) {
      return issue('You need to specify the rounds for that game')
    }
    if (!data.moveTimer || data.moveTimer.length <= 0) {
      return issue('You need to specify the move timer')
    }
    if (data.gameType != 'Rounds' && data.gameType != 'All cards') {
      return issue('The round type is invalid')
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
      return socket.emit('issue', {
        msg: 'You can only create one game per user',
      })
    }
    try {
      let newGame = new Game(gameObject)
      await newGame.save()
    } catch (e) {
      return issue("Error creating the new game")
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
        return socket.emit('issue', {
          msg: "That game couldn't be found",
        })
      }
      game.enemyUserId = req.session.user.userId
      await game.save()
    } catch (e) {
      return socket.emit('issue', {
        msg: "Error processing the join request",
      })
    }
    // Emit event to inform the other user
    io.emit('game:join-complete', {
      playerOne: data.userId,
      playerTwo: req.session.user.userId,
    })
  })
  socket.on('game:delete', async () => {
    const gameExistingIndex = socketGames.map(game => game.playerOne).indexOf(socket.id)
    if (gameExistingIndex != -1) {
      socketGames.splice(gameExistingIndex, 1)
    }
    try {
      await Game.findOneAndRemove({playerOne: socket.id})
    } catch (e) {
      console.log('Error', e)
      return socket.emit('issue', {
        msg: 'Error deleting the game',
      })
    }
  })

  socket.on('setup:login-with-crypto', async data => {
    const issue = msg => {
      return socket.emit('issue', { msg })
    }
    let responseMsg
    try {
      if (!data.mnemonic || data.mnemonic.length == 0) {
        return issue("Mnemonic not received")
      }
      if (data.mnemonic.split(' ').length != 12) {
        return issue("The mnemonic received must be 12 words")
      }
      data.mnemonic = data.mnemonic.trim()
      let foundUser = await User.findOne({mnemonic: data.mnemonic})
      let userId
      // Existing account, login
      if (foundUser) {
        // Log in for that found user
        userId = foundUser._id;
        responseMsg = "User logged in successfully"
      } else {
        // New account, register
        let newUser = new User({
          mnemonic: data.mnemonic,
        })
        try {
          await newUser.save()
        } catch (e) {
          console.log("Error saving new mnemonic user", e)
          return issue("Error saving your new account")
        }
        userId = newUser._id;
        responseMsg = "New user created successfully"
      }
      const userAddress = (new TronAddress(data.mnemonic, 0)).master
      console.log('User address', userAddress)
      const balance = (await tronGrid.account.get(userAddress)).data[0].balance
      console.log('Balance', balance)
      socket['user'] = {
        userId,
        userAddress,
        balance,
      }
      return socket.emit('setup:login-complete', {
        response: {
          msg: responseMsg,
          userId,
          userAddress,
          balance,
        },
      })
    } catch (e) {
      console.log("Error processing the request", e)
      return issue("Error processing the request on the server")
    }
  })
  socket.on('setup:login', async data => {
    const issue = msg => {
      return socket.emit('issue', { msg })
    }
    if (!data.email || data.email.length == 0) {
      return issue("The email is missing")
    }
    if (!data.password || data.password.length == 0) {
      return issue("The password is missing")
    }
    let foundUser
    try {
      foundUser = await User.findOne({email: data.email})
    } catch(err) {
      return issue('Error processing the request')
    }
    if (!foundUser) {
      return issue('User not found')
    }
    foundUser.comparePassword(data.password, async isMatch => {
      if (!isMatch) {
        return issue('User found but the password is invalid')
      }
      const userId = foundUser._id;
      const userAddress = (new TronAddress(foundUser.mnemonic, 0)).master
      console.log('User address', userAddress)
      const balance = await tronWeb.trx.getBalance(userAddress)
      console.log('Balance', balance)
      socket['user'] = {
        userId,
        userAddress,
        balance,
      }
      return socket.emit('setup:login-complete', {
        response: {
          msg: 'User logged in successfully',
          userId,
          userAddress,
          balance,
        },
      })
    })
  })
  socket.on('setup:register', async data => {
    const issue = msg => {
      console.log('Called issue', msg)
      return socket.emit('issue', { msg })
    }
    let foundUser
    try {
      foundUser = await User.findOne({email: data.email})
    } catch(err) {
      return issue('Error processing the request')
    }
    // If we found a user, return a message indicating that the user already exists
    if(foundUser) {
      return issue('The user already exists, login or try again')
    }
    if (data.password.length < 6) {
      return issue('The password must be at least 6 characters')
    }
    const mnemonic = TronAddress.generateMnemonic()
    const userAddress = (new TronAddress(mnemonic, 0)).master
    const a = await tronWeb.trx.getBalance(userAddress)

    let newUser = new User({
      email: data.email,
      password: data.password,
      username: data.username,
      mnemonic,
    })
    const userId = newUser._id;

    try {
      await newUser.save()
    } catch (e) {
      console.log('Error saving the new user', e)
      return issue('Error saving the new user')
    }
    socket['user'] = {
      userId,
      userAddress,
      balance: 0,
    }
    const response = {
      msg: "User registered successfully",
      userId,
      userAddress,
      balance: 0,
    }
    console.log('Response', response)
    return socket.emit('setup:login-complete', {
      response,
    })
  })
})

http.listen(port, '0.0.0.0', async () => {
  await start()
  console.log(`Listening on localhost:${port}`)
})

async function start() {
  try {
    socketGames = await Game.find()
    console.log("Got games from the database to the socket")
  } catch (e) {
    console.log("Couldn't get the database games")
  }
}

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
