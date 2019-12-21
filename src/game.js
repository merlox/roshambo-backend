const mongoose = require('mongoose')
const bcrypt = require('bcrypt')

const gameSchema = new mongoose.Schema({
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
}, {
    timestamps: true,
})

const Game = mongoose.model('Game', gameSchema)
module.exports = Game
