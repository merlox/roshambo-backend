require('dotenv-safe').config()

const { TRON_PRIVATE_KEY, GAME_CONTRACT, TRON_ADDRESS } = process.env
const express = require('express')
const bodyParser = require('body-parser')
const app = express()
const User = require('./src/user')
const Game = require('./src/game')
const yargs = require('yargs')
const mongoose = require('mongoose')
const session = require('express-session')
const MongoStore = require('connect-mongo')(session)
const bip39 = require('bip39')
const TronAddress = require('@bitsler/tron-address')
const TronGrid = require('trongrid')
const TronWeb = require('tronweb')
const http = require('http').createServer(app)
const io = require('socket.io')(http)
const exec = require('child_process').exec

// TODO Change the fullhost to mainnet: https://api.trongrid.io
// Instead of testnet: https://api.shasta.trongrid.io
let tronWeb
let tronGrid
// Addresses
const contractAddress = GAME_CONTRACT
let contractInstance

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
const mongoUrl = process.env.TEST_ENV ? 'mongodb://localhost:27017/test' : 'mongodb://localhost:27017/roshambo'

// This is to simplify everything but you should set it from the terminal
// required to encrypt user accounts
process.env.SALT = 'example-merlox120'
mongoose.set('useNewUrlParser', true)
mongoose.set('useFindAndModify', false)
mongoose.set('useCreateIndex', true)
mongoose.set('useUnifiedTopology', true)
mongoose.connect(mongoUrl, {
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

// Gets called when a git push is detected automatically and updates the server
app.post('/webhook', (req, res) => {
  console.log('Running git pull and pm2 restart all')
  exec("git pull && pm2 restart all", (err, stdout, stderr) => {
    if (err) {
      console.log('Error git pulling:', err)
    }
    console.log('Stdout', stdout)
  });
})

let socketIds = []
// Games shown on the matchmaking scene
let socketGames = []
// Active games played by people in a room
let gameRooms = []

async function deleteGame(socket) {
  const index = socketIds.indexOf(socket.id)
  const gameExistingIndex = socketGames.map(game => game.playerOne).indexOf(socket.id)
  if (index != -1) {
    socketIds.splice(index, 1) // Delete 1
  }
  if (gameExistingIndex != -1) {
    socketGames.splice(gameExistingIndex, 1)
    console.log('Deleted game successfully')
  }
  try {
    const game = await Game.findOne({playerOne: socket.id})
    // Only delete non started games from the database
    if (game && game.status == 'CREATED') {
      await game.deleteOne()
    }
  } catch (e) {
    console.log('Error', e)
    console.log('Error deleting socket games from the database:', socket.id)
  }
  // Emit the updated games to all players
  io.emit('game:get-games', {
    data: socketGames,
  })
}

// Returns the instantiated trongrid
async function setupTronGrid(privateKey) {
  const web = new TronWeb({
    fullNode: 'https://api.trongrid.io',
    solidityNode: 'https://api.trongrid.io',
    eventServer: 'https://api.trongrid.io',
    privateKey,
  })
  web.defaultAddress = {
    hex: web.address.toHex(TRON_ADDRESS),
    base58: TRON_ADDRESS
  }
  contractInstance = await web.contract().at(contractAddress)
  const grid = new TronGrid(web)
  return { web, grid }
}

io.on('connection', socket => {
  console.log('User connected', socket.id)
  socketIds.push(socket.id)
  // Logging middleware
  socket.use((package, next) => {
    console.log('\nGET', package[0])
    next()
  })
  socket.on('disconnect', async () => {
    console.log('User disconnected', socket.id)
    deleteGame(socket)
  })

  // It will be created for the logged in socket.id
  // let game = {
  //  gameName, gameType -> ‘Rounds’ or ‘All cards’, rounds, moveTimer, totalCardsPlayerOne
  //  optional qrData
  // }
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
      isPrivateGame: data.qrData ? true : false,
      qrData: data.qrData,
      roomId: null,
      playerOne: socket.id,
      playerTwo: null,
      gameName: data.gameName,
      gameType: data.gameType,
      // All rounds means use all the 9 cards
      rounds: data.gameType == 'All cards' ? 10 : data.rounds,
      moveTimer: data.moveTimer,
      currentRound: 1,
      playerOneActive: null,
      playerTwoActive: null,
      starsPlayerOne: 3,
      starsPlayerTwo: 3,
      cardsUsedPlayerOne: 0,
      cardsUsedPlayerTwo: 0,
      totalCardsPlayerOne: data.totalCardsPlayerOne,
      totalCardsPlayerTwo: null,
    }
    const gameExisting = socketGames.map(game => game.playerOne).find(playerOne => playerOne == socket.id)
    if (gameExisting) {
      return socket.emit('issue', {
        msg: 'You can only create one game per user',
      })
    }
    let newGame
    try {
      newGame = new Game(gameObject)
      await newGame.save()
    } catch (e) {
      return issue("Error creating the new game")
    }
    socketGames.push(gameObject)
    io.emit('game:create-complete', {
      msg: 'The game has been created successfully',
      id: newGame._id, // New game id
    })
  })
  socket.on('game:get-games', () => {
    const onlyPublicGames = socketGames.filter(game => !game.isPrivateGame)
    socket.emit('game:get-games', {
      data: onlyPublicGames,
    })
  })
  // let game = {
  //   playerOne, playerTwo, gameName, gameType, rounds, moveTimer, totalCardsPlayerTwo
  // }
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
    let latestLeagueInfo = null
    try {
      latestLeagueInfo = await contractInstance.getRemainingCardsInLeague().call()
    } catch (e) {
      console.log('No league found, sending empty game stats...')
    }

    const room = {
      isPrivateGame: data.isPrivateGame,
      qrData: data.qrData,
      roomId,
      playerOne: data.playerOne,
      playerTwo: data.playerTwo,
      gameName: data.gameName,
      gameType: data.gameType,
      rounds: data.rounds,
      moveTimer: data.moveTimer,
      currentRound: 1,
      playerOneActive: null,
      playerTwoActive: null,
      starsPlayerOne: 3,
      starsPlayerTwo: 3,
      timeout: null,
      leagueRocksInGame: 0,
      leaguePapersInGame: 0,
      leagueScissorsInGame: 0,
      cardsUsedPlayerOne: 0,
      cardsUsedPlayerTwo: 0,
      totalCardsPlayerOne: game.totalCardsPlayerOne,
      totalCardsPlayerTwo: data.totalCardsPlayerTwo,
    }
    if (latestLeagueInfo) {
      room.leagueRocksInGame = parseInt(latestLeagueInfo[0]._hex)
      room.leaguePapersInGame = parseInt(latestLeagueInfo[1]._hex)
      room.leagueScissorsInGame = parseInt(latestLeagueInfo[2]._hex)
    }

    gameRooms.push(room)
    socket.join(roomId)

    // Emit event to inform the users
    socket.emit('game:join-complete', room)
    io.to(data.playerOne).emit('game:join-complete', room)
  })
  socket.on('game:delete', async () => {
    deleteGame(socket)
  })
  // data = {
  //   roomId, cardType, privateKey, sender
  // }
  socket.on('game:card-placed', async data => {
    let lastCardPlacedByPlayer
    console.log('Rooms', gameRooms)
    console.log('ROOM ID', data.roomId)
    console.log('SOCKETID', socket.id)
    const game = gameRooms.find(room => room.roomId == data.roomId)
    
    if (!game) return issue('Game not found')
    clearTimeout(game.timeout)
    const timer = (parseInt(game.moveTimer) + 2) * 1e3
    let counter = new Date().getTime()
    game.timeout = setTimeout(() => {
      console.log('Timeout called after', new Date().getTime() - counter, 'seconds')
      if (lastCardPlacedByPlayer == 'one') {
        return send('game:finish:winner-player-one')
      } else {
        return send('game:finish:winner-player-two')
      }
    }, timer) // Extra 2 for animation transitions

    // To delete a game room from the active ones in the rooms and socketGames
    // arrays while marking the database model as completed
    function issue(msg) {
      return socket.emit('issue', { msg })
    }
    async function deleteRoom (winner) {
      const roomIndex = gameRooms.map(room => room.roomId).indexOf(data.roomId)
      if (roomIndex != -1) gameRooms.splice(roomIndex, 1)
      let socketGamesIndex = socketGames.map(sock => sock.playerOne).indexOf(game.playerOne)
      if (socketGamesIndex != -1) socketGames.splice(socketGamesIndex, 1)
      try {
        const dbGame = await Game.findOne({playerOne: game.playerOne})
        dbGame.status = 'COMPLETED'
        dbGame.winner = winner
        await dbGame.save()
      } catch (e) {
        console.log('Error', e)
        console.log('Error deleting socket games from the database:', socket.id)
      }
    }
    async function emitRoundOver (result) {
      let latestLeagueInfo = null
      try {
        latestLeagueInfo = await contractInstance.getRemainingCardsInLeague().call()
      } catch (e) {
        console.log('No league found, sending empty game stats...')
      }
      const msg = {
        starsPlayerOne: game.starsPlayerOne,
        starsPlayerTwo: game.starsPlayerTwo,
        playerOneActive: game.playerOneActive,
        playerTwoActive: game.playerTwoActive,
        rocks: 0,
        papers: 0,
        scissors: 0,
      }
      if (latestLeagueInfo) {
        msg.rocks = parseInt(latestLeagueInfo[0]._hex)
        msg.papers = parseInt(latestLeagueInfo[1]._hex)
        msg.scissors = parseInt(latestLeagueInfo[2]._hex)
      }
      console.log('League info', latestLeagueInfo)
      socket.emit(`game:round:${result}`, msg)
      io.to(socket.id == game.playerOne ? game.playerTwo : game.playerOne)
        .emit(`game:round:${result}`, msg)
      game.playerOneActive = null
      game.playerTwoActive = null
    }
    // To send the finishing message
    function send(endpoint) {
      const isPlayerOne = socket.id == game.playerOne
      game.timeout = clearTimeout(game.timeout)
      deleteGame(socket)
      socket.emit(endpoint)
      io.to(isPlayerOne ? game.playerTwo : game.playerOne).emit(endpoint)
    }
    function checkFinishGame() {
      // When you join your game, you should add the number of cards you have
      // check if that limit is reached and increase the counter on placement

      // If stars 0 for any player, emit victory
      if (game.starsPlayerOne == 0) {
        console.log("GAME OVER Player 2 wins for stars")
        deleteRoom(game.playerTwo)
        send('game:finish:winner-player-two')
        return true
      }
      if (game.starsPlayerTwo == 0) {
        console.log("GAME OVER Player 1 wins for stars")
        deleteRoom(game.playerOne)
        send('game:finish:winner-player-one')
        return true
      }

      // If the rounds are over OR the timeout is reached OR a player has used all
      // of his selected cards, emit the winner this includes the 9 max rounds for
      // All rounds mode
      if (parseInt(game.currentRound) >= parseInt(game.rounds)
        || game.cardsUsedPlayerOne >= game.totalCardsPlayerOne
        || game.cardsUsedPlayerTwo >= game.totalCardsPlayerTwo) {
        console.log("All rounds over, emiting winner:")
        if (game.starsPlayerOne > game.starsPlayerTwo) {
          console.log("GAME OVER Winner player one for rounds over")
          deleteRoom(game.playerOne)
          send('game:finish:winner-player-one')
          return true
        } else if (game.starsPlayerOne < game.starsPlayerTwo) {
          console.log("GAME OVER Winner player two for rounds over")
          deleteRoom(game.playerTwo)
          send('game:finish:winner-player-two')
          return true
        } else {
          console.log("GAME OVER DRAW")
          deleteRoom('draw')
          send('game:finish:draw')
          return true
        }
      }
      return false
    }

    if (socket.id == game.playerOne) {
      game.playerOneActive = data.cardType
      lastCardPlacedByPlayer = 'one'
    } else if (socket.id == game.playerTwo) {
      game.playerTwoActive = data.cardType
      lastCardPlacedByPlayer = 'two'
    } else {
      return issue('The player socket id is not in the game')
    }

    async function deleteCard() {
      // When a card is placed, it is deleted from the contract
      console.log('Deleting card...')
      let transaction
      try {
        const { web, grid } = await setupTronGrid(data.privateKey)
        transaction = await contractInstance.deleteCard(data.cardType).send({
          from: data.sender,
        })
        console.log('Card deleted successfully...')
      } catch (e) {
        console.log('The card deletion transaction failed...', e)
        return issue("The card deletion transaction failed")
      }
    }

    await deleteCard()

    console.log(game.playerOneActive)
    console.log(game.playerTwoActive)

    // If both cards are placed, calculate result
    if (game.playerOneActive && game.playerTwoActive) {
      game.cardsUsedPlayerOne++
      game.cardsUsedPlayerTwo++
      game.currentRound++
      const winner = calculateWinner(game.playerOneActive, game.playerTwoActive)
      let winnerText = ''

      switch (winner) {
        case false:
          console.log('No winner detected, emitting round draw')
          winnerText = 'draw'
          break
        case 'one':
          console.log("Winner one detected!")
          game.starsPlayerOne++
          game.starsPlayerTwo--
          winnerText = 'winner-one'
          break
        case 'two':
          console.log("Winner two detected!")
          game.starsPlayerOne--
          game.starsPlayerTwo++
          winnerText = 'winner-two'
          break
      }

      socket.emit('game:card-placement-done', {
        msg: 'The card has been placed successfully'
      })

      console.log('FINISH 1')

      const isThereAWinner = checkFinishGame()
      if (isThereAWinner) return
      else return emitRoundOver(winnerText)
    }

    console.log('FINISH 2')

    socket.emit('game:card-placement-done', {
      msg: 'The card has been placed successfully'
    })
    // If only one card is placed, do nothing and wait for the opponent
  })
  socket.on('game:join-private-game', async data => {
    const issue = msg => {
      console.log('Called issue', msg)
      return socket.emit('issue', { msg })
    }
    if (!data.gameId || data.gameId.length == 0) {
      return issue("Game code is missing")
    }
    let game
    try {
      game = await Game.findOne({_id: data.gameId})
      if (!game) {
        return issue("Game not found")
      }
    } catch (e) {
      return issue("Game not found")
    }
    const roomId = "room" + gameRooms.length
    let latestLeagueInfo = null
    try {
      latestLeagueInfo = await contractInstance.getRemainingCardsInLeague().call()
    } catch (e) {
      console.log('No league found, sending empty game stats...')
    }
    game.roomId = roomId
    game.playerTwo = socket.id
    game.status = 'STARTED'
    game.cardsUsedPlayerOne = []
    game.cardsUsedPlayerTwo = []

    if (latestLeagueInfo) {
      room.leagueRocksInGame = parseInt(latestLeagueInfo[0]._hex)
      room.leaguePapersInGame = parseInt(latestLeagueInfo[1]._hex)
      room.leagueScissorsInGame = parseInt(latestLeagueInfo[2]._hex)
    } else {
      game.leagueRocksInGame = 0
      game.leaguePapersInGame = 0
      game.leagueScissorsInGame = 0
    }

    // Update the game with the room and state
    try {
      await game.save()
    } catch (e) {
      return issue("Error joining the game")
    }
    gameRooms.push(game)
    socket.join(roomId)
    // Emit event to inform the users
    socket.emit('game:join-complete', game)
    io.to(game.playerOne).emit('game:join-complete', game)
  })
  socket.on('game:save-board', async data => {
    const issue = msg => {
      console.log('Called issue', msg)
      return socket.emit('issue', { msg })
    }
    if (!data || data.board0 == undefined) {
      console.log('Board not received')
      return issue('Board not received')
    }
    if (!data || !data.privateKey) {
      console.log('Private key not received')
      return issue('Private key not received')
    }
    let board = []
    for(let i = 0; i < 9; i++) {
      board[i] = data["board"+i]
    }
    // Save board on your user account, find the user data
    try {
      let foundUser = await User.findOne({privateKey: data.privateKey})
      foundUser.board = board
      try {
        await foundUser.save()
      } catch (e) {
        console.log('Saving board error', e)
        return issue('Error saving the board')
      }
    } catch (e) {
      return issue('Error finding the user account')
    }
    socket.emit('game:save-board-complete')
  })
  socket.on('game:get-board', async data => {
    let foundUser
    const issue = msg => {
      console.log('Called issue', msg)
      return socket.emit('issue', { msg })
    }
    if (!data || !data.privateKey) {
      console.log('Private key not received')
      return issue('Private key not received')
    }
    // Save board on your user account, find the user data
    try {
      foundUser = await User.findOne({privateKey: data.privateKey})
    } catch (e) {
      return issue('Error finding the user account')
    }
    socket.emit('game:board', {
      data: foundUser.board,
    })
  })

  // Returns the league data
  // data = {
  //   cardsToBuy, account, privateKey
  // }
  socket.on('tron:buy-cards', async data => {
    const issue = msg => {
      return socket.emit('issue', { msg })
    }
    if (!data.cardsToBuy) {
      return issue("You need to specify how many cards you want to purchase")
    }
    if (!data.account) {
      return issue("Account not received")
    }
    let transaction
    try {
      const { web, grid } = await setupTronGrid(data.privateKey)
      transaction = await contractInstance.buyCards(data.cardsToBuy).send({
        callValue: tronWeb.toSun(10) * data.cardsToBuy,
        from: data.account,
      })
    } catch (e) {
      console.log('The card buying transaction failed...', e)
      return issue("The card buying transaction failed")
    }
    socket.emit('tron:buy-cards-complete')
  })

  // Gets your cards with id and all
  socket.on('tron:get-my-cards', async data => {
    let cards = []
    const issue = msg => {
      return socket.emit('issue', { msg })
    }
    console.log('Data received', data)
    if (!data.privateKey || data.privateKey.length == 0) {
      console.log('Private key not received')
      return issue('Private key not received')
    }
    await setupTronGrid(data.privateKey)
    try {
      cards = await contractInstance.getMyCards().call({
        from: data.account,
      })
    } catch (e) {
      console.log('Error getting your cards')
      return issue("Error getting your cards")
    }
    // TODO This is temporary
    // cards = [[1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5]]

    socket.emit('tron:get-my-cards', {
      data: cards, // Rocks then papers then scissors
    })
  })
  
  // data = {
  //   privateKey,
  // }
  socket.on('setup:login-with-crypto-private-key', async data => {
    const issue = msg => {
      return socket.emit('issue', { msg })
    }
    let responseMsg
    try {
      if (!data.privateKey || data.privateKey.length == 0) {
        return issue("Private key not received")
      }
      data.privateKey = data.privateKey.trim()
      let foundUser = await User.findOne({privateKey: data.privateKey})
      let userId
      // Existing account, login
      if (foundUser) {
        // Log in for that found user
        userId = socket.id;
        responseMsg = "User logged in successfully"
      } else {
        // New account, register
        let newUser = new User({
          privateKey: data.privateKey,
        })
        try {
          await newUser.save()
        } catch (e) {
          console.log("Error saving new private key user", e)
          return issue("Error saving your new account")
        }
        userId = socket.id;
        responseMsg = "New user created successfully"
      }
      const { web, grid } = await setupTronGrid(data.privateKey)
      const userAddress = web.address.fromPrivateKey(data.privateKey)
      console.log('USER ADDRESS', userAddress)
      let balance = (await grid.account.get(userAddress))
      if (!balance.data || balance.data.length == 0) {
        balance = 0
      } else {
        balance = balance.data[0].balance
      }
      console.log('BALANCE', balance)
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
          privateKey: data.privateKey,
          balance,
        },
      })
    } catch (e) {
      console.log("Error processing the request", e)
      return issue("Error processing the request on the server")
    }
  })
  // data = {
  //   email, password, 
  // }
  // returns response = {
  //   msg,
  //   userId, // The socket id of the user
  //   userAddress,
  //   balance,
  //   privateKey
  // }
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
      const userAddress = await tronWeb.address.fromPrivateKey(foundUser.privateKey)
      const balance = await tronWeb.trx.getBalance(userAddress)
      console.log('Balance', balance)
      socket['user'] = {
        userId,
        userAddress,
        balance,
        privateKey: foundUser.privateKey,
      }

      return socket.emit('setup:login-complete', {
        response: {
          msg: 'User logged in successfully',
          userId,
          userAddress,
          balance,
          privateKey: foundUser.privateKey,
        },
      })
    })
  })
  // Data is:
  // {
  //   email, password, username
  // }
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

    // Create an account with private key and address
    const acc = await tronWeb.createAccount()
    const privateKey = acc.privateKey
    const userAddress = acc.address.base58

    let newUser = new User({
      email: data.email,
      password: data.password,
      username: data.username,
      privateKey,
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
      privateKey,
    }
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
  let { web, grid } = await setupTronGrid(TRON_PRIVATE_KEY)
  tronWeb = web
  tronGrid = grid

  try {
    console.log("Setting up the game contract...")
    contractInstance = await tronWeb.contract().at(contractAddress)
    console.log("Done!")
  } catch (e) {
    console.log("Error setting up the game contract", e)
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

// Returns the private key
async function generateAddressesFromSeed(seed) {
  console.log('1')
  let bip39 = require("bip39")
  console.log('2')
  let hdkey = require('ethereumjs-wallet/hdkey')
  console.log('3')
  let hdwallet = hdkey.fromMasterSeed(await bip39.mnemonicToSeed(seed))
  let wallet_hdpath = "m/44'/60'/0'/0/0"
  console.log('4')
  let wallet = hdwallet.derivePath(wallet_hdpath).getWallet()
  console.log('5')
  let address = '0x' + wallet.getAddress().toString("hex")
  console.log('6')
  let privateKey = wallet.getPrivateKey()
  let privateKey2 = wallet.getPrivateKey().toString("hex")
  console.log('7')
  console.log(' ---Private key--- ', privateKey, ' ---private key 2--- ', privateKey2, ' ---address--- ', address)
  return (address, privateKey)
}
