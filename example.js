const child_process = require('child_process')

const child = child_process.spawn('node', ['server.js', '-p', '80'], {
    stdio: 'ignore',
    shell: true,
    detached: true,
});

child.on('exit', function (e, code) {
    console.log("finished");
});