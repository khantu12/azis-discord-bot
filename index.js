const Discord = require("discord.js");
const { prefix, token } = require("./config.json");
const ytdl = require("ytdl-core");
const decode = require("decode-html");
const axios = require("axios").default;
const clc = require("cli-color");

const client = new Discord.Client();

const queue = new Map();
const data = {};
var currentRequest = "";
var nrlogs = 2;

client.once("ready", () => {
    console.clear();
	logCurrentSong("", clc.bgYellow("NO SONG PLAYING"), "");
    process.stdout.cursorTo(0, 1);
	process.stdout.write("--------------------------------");
    process.stdout.cursorTo(0, 2);
});

client.once("reconnecting", () => {
    console.log("Reconnecting!");
});

client.once("disconnect", () => {
    console.log("Disconnect!");
});

// Handle discord user commands
client.on("message", async message => {
    if (message.author.bot) return;
    const userid = message.member.user.id;
    // Make field for user
    if (!(userid in data)) data[userid] = new Map();
    try {
        // Get the server queue
        const serverQueue = queue.get(message.guild.id);
        // Make request for a song from a song list
        if (data[userid].size > 0) {
            if (!message.content.startsWith(`${prefix}`)) {
                if (message.content.startsWith("c")) {
                    delete data[userid];
                    message.channel.send("Canceled!");
                    logToConsole(
                        message.member.user.tag,
                        clc.red,
                        "CANCELED",
                        currentRequest
                    );
                    currentRequest = "";
                } else if (message.content.startsWith("n")) {
                    // Get next page of the results (next;command)
                    sendYtSongsToChannel(
                        message.member.user.id,
                        message.channel,
                        10
                    );
                } else {
                    execute(message, serverQueue, true);
                }
            } else if (message.content.startsWith(`${prefix}p`)) {
                delete data[userid];
                execute(message, serverQueue);
            } else if (message.content.startsWith(`${prefix}s`)) {
                delete data[userid];
                skip(message, serverQueue);
            }
            return;
            // Make request without having made a one for song list
        } else if (message.content.startsWith(`${prefix}p`)) {
            execute(message, serverQueue);
            return;
            // Skip song
        } else if (message.content.startsWith(`${prefix}s`)) {
            skip(message, serverQueue);
            return;
        } else if (!message.content.startsWith(prefix)) {
            return;
        } else {
            message.channel.send("You need to enter a valid command!");
        }
    } catch (e) {
        message.channel.send("Error occurred: " + e);
    }
});

const execute = async (message, serverQueue, selecting = false) => {
    // Check if user is in a voice channel
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel)
        return message.channel.send(
            "You need to be in a voice channel to play music!"
        );
    // Check if the bot has 'connect' and 'speak' permissions
    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has("CONNECT") || !permissions.has("SPEAK")) {
        return message.channel.send(
            "I need the permissions to join and speak in your voice channel!"
        );
    }

	const song = await getSong(message, selecting);
	if (song === undefined) return;
    // Get the info for the song
    if (!serverQueue) {
        // Make the queue construct
        const queueConstruct = {
            textChannel: message.channel,
            voiceChannel: voiceChannel,
            connection: null,
            songs: [],
            volume: 5,
            playing: true
        };
        // Set the queue construct
        queue.set(message.guild.id, queueConstruct);
        queueConstruct.songs.push(song);
        // Try to establish a connection and play the song
        try {
            let connection = await voiceChannel.join();
            queueConstruct.connection = connection;
            play(message, queueConstruct.songs[0]);
        } catch (err) {
            console.log(err);
            queue.delete(message.guild.id);
            return message.channel.send(err);
        }
    } else {
        serverQueue.songs.push(song);
        message.channel.send(`**${song.title}** has been added to the queue!`);
		const usertag = message.member.user.tag;
        logToConsole(usertag, clc.yellow, "QUEUED", song.title);
        return;
    }
};

const skip = (message, serverQueue) => {
    if (!message.member.voice.channel)
        return message.channel.send(
            "You have to be in a voice channel to stop the music!"
        );
    if (!serverQueue)
        return message.channel.send("There is no song that I could skip!");
    const usertag = message.member.user.tag;
    logToConsole(usertag, clc.magenta, "SKIP", serverQueue.songs[0].title);
    serverQueue.connection.dispatcher.end();
};

const play = (message, song) => {
    const guild = message.guild;
    const serverQueue = queue.get(guild.id);
    const usertag = message.member.user.tag;
    if (!song) {
		logCurrentSong("", clc.bgYellow("NO SONG PLAYING"), "");
        serverQueue.voiceChannel.leave();
        queue.delete(guild.id);
        return;
    }
    try {
        const dispatcher = serverQueue.connection
            .play(ytdl(song.url, { filter: "audioonly" }))
            .on("finish", () => {
                serverQueue.songs.shift();
                play(message, serverQueue.songs[0]);
            })
            .on("error", error => console.error(error));
		logCurrentSong(song.usertag, clc.bgGreenBright("NOW PLAYING"), song.title);
        dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);
        serverQueue.textChannel.send(`Start playing: **${song.title}**`);
        logToConsole(song.usertag, clc.green, "PLAYING", song.title);
    } catch {
        logToConsole(
            usertag,
            clc.red.bold,
            "ERROR",
            "Was not able to fetch song"
        );
    }
};

const getSong = async (message, selecting) => {
    const usertag = message.member.user.tag;
    if (selecting) {
        const userid = message.member.user.id;
        const song = data[userid].get(message.content);
        delete data[userid];
		return song;
    } else {
        const cmdArgs = message.content
            .split(" ")
            .slice(1)
            .toString();
		if (cmdArgs.includes("www")) {
			let songInfo = undefined;
			while (songInfo === undefined) {
				songInfo = await ytdl.getInfo(cmdArgs).catch(e => {
					logToConsole(usertag, clc.bgRedBright, "ERROR", e);
				});
			}
			return {
				title: songInfo.title,
				url: songInfo.video_url,
				usertag: usertag
			};
		} else {
			currentRequest = cmdArgs.split(",").join(" ");
			fetchYtSongs(message, cmdArgs);
			return undefined;
		}
    }
}

const fetchYtSongs = (message, song) => {
    const userid = message.member.user.id;
    const usertag = message.member.user.tag;
    const searchString = song.split(",").join("+");
    logToConsole(usertag, clc.cyan, "FETCHING", song.split(",").join(" "));
    axios
        .get(
            "https://www.youtube.com/results?search_query=" +
                searchString +
                "&sp=EgIQAQ%253D%253D"
        )
        .then(result => {
            const d = result.data.match(
                /(?<=window\["ytInitialData"\] = )(.+)(?=;)/gm
            );
            let records;
            try {
                records = JSON.parse(d[0]).contents
                    .twoColumnSearchResultsRenderer.primaryContents
                    .sectionListRenderer.contents[0].itemSectionRenderer
                    .contents;
            } catch {
                fetchYtSongs(message, song);
                return;
            }
            let count = 0;
            for (let i = 0; i < records.length; i++) {
                const video = records[i].videoRenderer;
                if (video === undefined) continue;
                count++;
                const title = video.title.runs[0].text;
                const url =
                    video.navigationEndpoint.commandMetadata.webCommandMetadata
                        .url;
                // Set the songs in a map
                data[userid].set(count.toString(), {
                    title: decode(title),
                    url: url,
                    usertag: usertag
                });
            }
            if (data[userid].keys().count === 0) fetchYtSongs(message, song);
            sendYtSongsToChannel(message.member.user.id, message.channel);
            return;
        });
    return;
};

const sendYtSongsToChannel = (userid, channel, start = 1, amount = 10) => {
    const end = start % 8;
    let str = "";
    for (let [key, value] of data[userid]) {
        if (start === amount * end) break;
        if (start == key) {
            str += `${key}.    **${value.title}**\n`;
            start++;
        }
    }
    if (str !== " " && str) {
        channel.send(str);
    }
};

const logToConsole = (usertag, color, status, text) => {
    console.log(
        `${color(`[${status}]`)}${" ".repeat(
            8 - status.length
        )}: ${text} (${clc.cyanBright(usertag)})`
    );
    nrlogs++;
};

const logCurrentSong = (usertag, status, songTitle) => {
	process.stdout.cursorTo(0, 0);
	process.stdout.clearLine();
	process.stdout.write(
		clc.whiteBright.bold(
			status +
			": " +
			songTitle
		) +
		` (${clc.cyanBright(usertag)})`
	);
	process.stdout.cursorTo(0, nrlogs);
}

client.login(token);
