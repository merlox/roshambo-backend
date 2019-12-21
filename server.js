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

let socketIds = []
let socketGames = [] // Each game contains the game object
let gameRooms = []
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
    console.log('Game existing index', gameExistingIndex)
    if (index != -1) {
      socketIds.splice(index, 1) // Delete 1
    }
    if (gameExistingIndex != -1) {
      socketGames.splice(gameExistingIndex, 1)
      console.log('Deleted game successfully on disconnect -----')
    }
    try {
      const game = await Game.findOne({playerOne: socket.id})
      // Only delete non started games
      if (game && game.status == 'CREATED') {
        await game.deleteOne()
      }
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
    io.emit('game:create-complete', {
      msg: 'The game has been created successfully',
    })
  })
  socket.on('game:get-games', (callback) => {
    callback(socketGames)
  })
  socket.on('game:join', async data => {
    const issue = msg => {
      console.log('Called issue', msg)
      return socket.emit('issue', { msg })
    }

    // Setup the user id on my game
    let game
    if (!data.playerOne || data.playerOne.length == 0) {
      return issue('The player one data is missing')
    }
    if (!data.playerTwo || data.playerTwo.length == 0) {
      return issue('The player two data is missing')
    }
    if (!data.gameName || data.gameName.length == 0) {
      return issue('The game name is missing')
    }
    if (!data.gameType || data.gameType.length == 0) {
      return issue('The game type is missing')
    }
    if (!data.rounds || data.rounds.length == 0) {
      return issue('The game rounds is missing')
    }
    if (!data.moveTimer || data.moveTimer.length == 0) {
      return issue('The game move timer is missing')
    }

    try {
      game = await Game.findOne({playerOne: data.playerOne})
      game.playerTwo = data.playerTwo
      game.gameName = data.gameName
      game.gameType = data.gameType
      game.rounds = data.rounds
      game.moveTimer = data.moveTimer
      game.status = 'STARTED'
      if (!game) {
        return issue("Couldn't find the game you're looking for")
      }
      await game.save()
    } catch (e) {
      console.log('Error', e)
      return issue("Error processing the join request")
    }
    const roomId = "room" + gameRooms.length
    const room = {
      roomId,
      playerOne: data.playerOne,
      playerTwo: data.playerTwo,
      gameName: data.gameName,
      gameType: data.gameType,
      rounds: data.rounds,
      moveTimer: data.moveTimer,
    }
    gameRooms.push(room)
    socket.join(roomId)

    // Emit event to inform the users
    socket.emit('game:join-complete', room)
    io.to(data.playerOne).emit('game:join-complete', room)
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
  socket.on('game:card-placed', async data => {
    const issue = msg => {
      return socket.emit('issue', { msg })
    }
    console.log('Card placed called')
    const game = gameRooms.find(room => room.roomId == data.roomId)
    if (!game) {
      return issue('Game not found')
    }
    game.currentRound++

    if (data.player == 'one') {
      game.playerOneActive = data.cardType
    } else {
      game.playerTwoActive = data.cardType
    }

    console.log('Game rooms:', gameRooms)

    // If both cards are placed, calculate result
    if (game.playerOneActive && game.playerTwoActive) {
      const winner = calculateWinner(game.playerOneActive, game.playerTwoActive)
      console.log("Winner ? ", winner)
      if (!winner) {
        console.log('No winner deteceted, emitting round draw')
        game.playerOneActive = null
        game.playerTwoActive = null
        return socket.to(game.roomId).emit('game:round:draw')
      }

      if (winner == 'one') {
        console.log("Winner one detected!")
        game.starsPlayerOne++
        game.starsPlayerTwo--
        console.log("After star change: ", game)
        // If stars 0 for any player, emit victory
        if (game.starsPlayerOne == 0) {
          console.log("Player 2 wins for stars")
          return socket.to(game.roomId).emit('game:finish:winner-player-two')
        }
        if (game.starsPlayerTwo == 0) {
          console.log("Player 1 wins for stars")
          return socket.to(game.roomId).emit('game:finish:winner-player-one')
        }
        // If the rounds are over, emit the winner
        if (game.currentRound >= game.rounds) {
          if (game.starsPlayerOne > game.starsPlayerTwo) {
            return socket.to(game.roomId).emit('game:finish:winner-player-one')
          } else if (game.starsPlayerOne < game.starsPlayerTwo) {
            return socket.to(game.roomId).emit('game:finish:winner-player-two')
          } else {
            return socket.to(game.roomId).emit('game:finish:draw')
          }
        }
        // Else complete this round
        return socket.to(game.roomId).emit('game:round:winner-one', {
          starsPlayerOne: game.starsPlayerOne,
          starsPlayerTwo: game.starsPlayerTwo,
        })
      }

      if (winner == 'two') {
        console.log("Winner two detected!")
        game.starsPlayerOne--
        game.starsPlayerTwo++
        // If stars 0 for any player, emit victory
        if (game.starsPlayerOne == 0) {
          return socket.to(game.roomId).emit('game:finish:winner-player-two')
        }
        if (game.starsPlayerTwo == 0) {
          return socket.to(game.roomId).emit('game:finish:winner-player-one')
        }
        // If the rounds are over, emit the winner
        if (game.currentRound >= game.rounds) {
          if (game.starsPlayerOne > game.starsPlayerTwo) {
            return socket.to(game.roomId).emit('game:finish:winner-player-one')
          } else if (game.starsPlayerOne < game.starsPlayerTwo) {
            return socket.to(game.roomId).emit('game:finish:winner-player-two')
          } else {
            return socket.to(game.roomId).emit('game:finish:draw')
          }
        }
        // Else complete this round
        return socket.to(game.roomId).emit('game:round:winner-two', {
          starsPlayerOne: game.starsPlayerOne,
          starsPlayerTwo: game.starsPlayerTwo,
        })
      }

      console.log("NOTHING detected!")
    }
    // If only one card is placed, do nothing and wait for the opponent
  })

  // TODO Check the following scenarios
  // DONE 1. Player one places a card, nothing happens until the other is placed
  // DONE 2. Player 2 places a card, nothing happens until the other is placed
  // DONE 3. Both players place their cards: draw
  // 4. Both players place their cards: winner one
  // 5. Both players place their cards: winner two
  // Check that the stars are being updated
  // Check the game finishing functionality after the rounds are over
  // Game finishing when stars are over
  // Game finishing when timeout is reached
  // Crear una AI que simule movimientos randoms

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
        userId = socket.id;
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
        userId = socket.id;
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
      const userId = socket.id;
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
    const userId = socket.id;

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

function calculateWinner(cardOne, cardTwo) {
  if (cardOne == cardTwo) {
    return false
  }
  if (cardOne == 'Rock' && cardTwo == 'Scissors') {
    return 'one'
  }
  if (cardOne == 'Rock' && cardTwo == 'Paper') {
    return 'two'
  }
  if (cardOne == 'Scissors' && cardTwo == 'Rock') {
    return 'two'
  }
  if (cardOne == 'Scissors' && cardTwo == 'Paper') {
    return 'one'
  }
  if (cardOne == 'Paper' && cardTwo == 'Rock') {
    return 'one'
  }
  if (cardOne == 'Paper' && cardTwo == 'Scissors') {
    return 'two'
  }
}
