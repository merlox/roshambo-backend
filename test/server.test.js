const expect = require('chai').expect
const io = require('socket.io-client')
const MongoClient = require('mongodb').MongoClient
const mongoUrl = 'mongodb://localhost/roshambo'
let socket = io('http://localhost')
let db = {}
let client = {} // The mongo client

// Used as an example user
let newUser = {
    email: 'example@gmail.com',
    password: 'example',
    username: 'example',
}

function registerUser() {
    socket.emit('setup:register', newUser)
    return new Promise((resolve, reject) => {
        // Check if user exists already
        const foundUser = await db.collection('users').findOne({ email: newUser.email })
        // Delete before adding it
        if (foundUser) {
            await db.collection('users').deleteOne({ email: newUser.email })
        }
        socket.on('setup:login-complete', async e => {
            try {
                const user = await db.collection('users').findOne({ email: newUser.email })
                expect(user).to.not.be.null
            } catch (e) {
                reject(e)
            }
            resolve()
        })
        socket.on('issue', e => {
            console.log('Issue', e)
            reject(e.msg)
        })
    })
}

describe('Server testing', async () => {
    it('Should do a fake test successfully', async () => {
        expect(true).to.be.true
    })
    it('Should connect to the server successfully', async () => {
        expect(socket.id).to.not.be.null
    })
    it('Should connect to the database successfully', async () => {
        client = new MongoClient(mongoUrl, {
            useUnifiedTopology: true,
        })
        await client.connect()
        db = client.db('roshambo')
        client.close()
    })

    describe('User registration and login', async () => {
        it('Should register a user properly with email', async () => {
            try {
                await registerUser()
            } catch (e) {
                throw new Error(e)
            }
            await db.collection('users').deleteOne({ email: newUser.email })
        })
        it('Should login a user properly', async () => {
            // let user = {
            //     email: 'example@gmail.com',
            //     password: 'example',
            // }
            // socket.emit('setup:login', user)
            // socket.on('setup:login-complete', async res => {
            //     console.log('Response', res.response)
            //     // Delete the example for future tests
            //     expect(res.response.msg).to.eq('User logged in successfully')
            // })
            // socket.on('issue', e => {
            //     console.log('Issue', e)
            // })
        })
        it('Should throw an error when login with a non-existing user')
    })

    describe('Game setup', async () => {
        it('Should create a game successfully')
        it('Should a game successfully')
    })

    describe('Card placement', async () => {
        it('Should place a card successfully')
        it('Should delete the card placed successfully')
        it('Should end the game when all cards are used')
        it('Should make a player lose after using all cards')
        it('Should make a player win after the other uses all cards')
    })
})