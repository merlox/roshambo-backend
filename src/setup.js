const mongoose = require('mongoose')

mongoose.connect('mongodb://localhost:27017/authentication', {
	useNewUrlParser: true,
	useCreateIndex: true,
})

const db = mongoose.connection
db.on('error', err => {
	console.log('Error connecting to the database', err)
})
db.once('open', function() {
    console.log('Opened database connection')
})
