const mongoose = require('mongoose')
const bcrypt = require('bcrypt')

const gameSchema = new mongoose.Schema({
  roomId: String,
  playerOne: String,
  playerTwo: String,
  gameName: String,
  gameType: String,
  rounds: String,
  moveTimer: String,
  status: {
    type: String,
    enum: ['CREATED', 'STARTED', 'COMPLETED'],
    default: 'CREATED',
  },
  winner: String, // UserId winner
  starsPlayerOne: {
    type: Number,
    default: 3,
  },
  starsPlayerTwo: {
    type: Number,
    default: 3,
  },
  currentRound: {
    type: Number,
    default: 1,
  },
  playerOneActive: String, // The current selected card can be Rock, Scissors, Paper
  playerTwoActive: String,
  isPrivateGame: Boolean,
  qrData: String, // for private games only
  boardOne: [String],
  boardTwo: [String],
  cardsUsedPlayerOne: Number,
  cardsUsedPlayerTwo: Number,
  totalCardsPlayerOne: Number,
  totalCardsPlayerTwo: Number,
}, {
  timestamps: true,
})

const Game = mongoose.model('Game', gameSchema)
module.exports = Game
