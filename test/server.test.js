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
    return new Promise(async (resolve, reject) => {
        // Check if user exists already
        const foundUser = await db.collection('users').findOne({ email: newUser.email })
        // Delete before adding it
        if (foundUser) {
            await db.collection('users').deleteOne({ email: newUser.email })
        }
        socket.emit('setup:register', newUser)
        socket.once('setup:login-complete', async () => {
            try {
                const user = await db.collection('users').findOne({ email: newUser.email })
                expect(user).to.not.be.null
                resolve()
            } catch (e) {
                reject(e)
            }
        })
        socket.once('issue', e => {
            reject(e.msg)
        })
    })
}

function loginUser(user) {
    return new Promise(async (resolve, reject) => {
        // Check if user exists already
        socket.emit('setup:login', user)
        socket.once('setup:login-complete', async res => {
            expect(res.response.msg).to.eq('User logged in successfully')
            resolve()
        })
        socket.once('issue', e => {
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
            try {
                await registerUser()
            } catch (e) {
                throw new Error(e)
            }
            let user = {
                email: 'example@gmail.com',
                password: 'example',
            }
            await loginUser(user)
        })
        it('Should throw an error when login with a non-existing user', async () => {
            let user = {
                email: 'aaaaaaaaaaaaaaaaaaaaaaa@gmail.com',
                password: 'fake',
            }
            try {
                await loginUser(user)
                // Should not continue
                expect(true).to.be.false
            } catch (e) {
                expect(e).to.eq('User not found')
            }
        })
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