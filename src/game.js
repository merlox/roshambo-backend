const mongoose = require('mongoose')
const bcrypt = require('bcrypt')

const gameSchema = new mongoose.Schema({
    email: String,
    gameName: String,
    gameType: String,
    rounds: Number,
    moveTimer: Number,
}, {
    timestamps: true,
})

const Game = mongoose.model('Game', gameSchema)
module.exports = Game
