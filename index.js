const Discord = require("discord.js");
const { prefix, token } = require("./config.json");
const ytdl = require("ytdl-core");
const decode = require("decode-html");
const axios = require("axios").default;

const client = new Discord.Client();

const queue = new Map();
const data = {};

client.once("ready", () => {
    console.log("Ready!");
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
    const userId = message.member.user.id;
	// Make field for user
    if (!(userId in data)) data[userId] = new Map();
    try {
        // Get the server queue
        const serverQueue = queue.get(message.guild.id);
        // Make request for a song from a song list
        if (
            data[userId].size > 0 &&
            !message.content.startsWith(`${prefix}p`)
        ) {
            if (message.content.startsWith("c")) {
                delete data[userId];
                message.channel.send("Canceled!");
            } else if (message.content.startsWith("n")) {
				// Get next page of the results (next;command)
                MessageList(message.member.user.id, message.channel, 10);
            } else {
                execute(message, serverQueue, true);
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
            // Cancel request
        } else if (message.content.startsWith(`${prefix}c`)) {
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
    var args;
    var url;
    const userId = message.member.user.id;
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
    // Get the url
    if (selecting) {
        // If selecting, get the url from the list
        url = data[userId].get(message.content).url;
        delete data[userId];
    } else {
        // If not selecting, search in yt for songs or just play the url
        args = message.content.split(" ");
        const cmdArgs = args.slice(1).toString(); // Get the args of the command (song search query)
        if (!cmdArgs.includes("www")) { // if doesn't have www in it, search for songs in yt
            FillSongs(message, cmdArgs);
            return;
        }
        url = cmdArgs;
    }
	// Get the info for the song
    const songInfo = await ytdl.getInfo(url);
    const song = {
        title: songInfo.title,
        url: songInfo.video_url
    };
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
		// Make the queue
        queue.set(message.guild.id, queueConstruct);
        queueConstruct.songs.push(song);
		// Try to establish a connection and play the song
        try {
            var connection = await voiceChannel.join();
            queueConstruct.connection = connection;
            play(message.guild, queueConstruct.songs[0]);
        } catch (err) {
            console.log(err);
            queue.delete(message.guild.id);
            return message.channel.send(err);
        }
    } else {
        serverQueue.songs.push(song);
        message.channel.send(`**${song.title}** has been added to the queue!`);
        console.log(`**${song.title}** has been added to the queue!`);
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
    serverQueue.connection.dispatcher.end();
};

const play = (guild, song) => {
    const serverQueue = queue.get(guild.id);
    if (!song) {
        serverQueue.voiceChannel.leave();
        queue.delete(guild.id);
        return;
    }
    const dispatcher = serverQueue.connection
        .play(ytdl(song.url, { filter: "audioonly" }))
        .on("finish", () => {
            serverQueue.songs.shift();
            play(guild, serverQueue.songs[0]);
        })
        .on("error", error => console.error(error));
    dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);
    serverQueue.textChannel.send(`Start playing: **${song.title}**`);
    console.log(`Start playing: **${song.title}**`);
};

const FillSongs = (message, song) => {
	const userId = message.member.user.id;
    const searchString = song.split(",").join("+");
    console.log("Getting songs list for: " + song);
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
            let jsonData;
            let records;
            try {
                jsonData = JSON.parse(d[0]);
                records =
                    jsonData.contents.twoColumnSearchResultsRenderer
                        .primaryContents.sectionListRenderer.contents[0]
                        .itemSectionRenderer.contents;
            } catch {
                FillSongs(message, song);
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
                data[userId].set(count.toString(), {
                    title: decode(title),
                    url: url
                });
            }
            if (data[userId].keys().count === 0) FillSongs(message, song);
			MessageList(message.member.user.id, message.channel);
            return;
        });
    return;
};

const MessageList = (userId, channel, start = 1, amount = 10) => {
    const end = start % 8;
    let str = "";
    for (let [key, value] of data[userId]) {
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

client.login(token);
