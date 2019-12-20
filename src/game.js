const mongoose = require('mongoose')
const bcrypt = require('bcrypt')

const gameSchema = new mongoose.Schema({
    playerOne: String,
    playerTwo: String,
    gameName: String,
    gameType: String,
    rounds: Number,
    moveTimer: Number,
    isComplete: {
      type: Boolean,
      default: false,
    },
    winner: String, // UserId winner
}, {
    timestamps: true,
})

const Game = mongoose.model('Game', gameSchema)
module.exports = Game
