const Discord = require("discord.js");
const {prefix, token} = require("./config.json");
const ytdl = require("ytdl-core-discord");
const decode = require("decode-html");
const axios = require("axios").default;
const clc = require("cli-color");

const client = new Discord.Client();

const queue = new Map();
const data = {};
var nrlogs = 2 + 6;

client.once("ready", () => {
	console.clear();
	logCurrentSong(undefined);
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
	// Get the server queue
	const serverQueue = queue.get(message.guild.id) || null;
	const isSelecting = data[userId].size > 0;
	const commandsList = isSelecting ? {
		'c': () => { 													// cancel
			delete data[userId];
			message.channel.send("Canceled!");
		},
		'n': () => sendYtSongsToChannel(userId, message.channel, 10), 	// next
		'a': () => execute(message, serverQueue, true), 				// select song
		'=p': () => { delete data[userId]; execute(message, serverQueue); }, 						// play
		'=s': () => { delete data[userId]; skip(message, serverQueue); }, 						// skip
	} : {
		'=p': () => execute(message, serverQueue), 						// play
		'=s': () => skip(message, serverQueue), 						// skip
		'=q': () => showQueue(message, serverQueue), 					// queue
	};
	const command = message.content.split(" ")[0].slice(0, 2);
	if (command[0] === prefix || isSelecting) {
		const commandToExecute = commandsList[parseInt(command) ? 'a' : command] || null;
		if (!commandToExecute) { return message.channel.send("You need to enter a valid command!"); }
		commandToExecute();
	}
});

const execute = async (message, serverQueue, selecting = false) => {
	const guildId = message.guild.id;
	const voiceChannel = message.member.voice.channel;

	// Check if user is in a voice channel
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
	if (!song) return;

	if (!serverQueue) {
		// Make the serverQueue
		const queueConstruct = {
			textChannel: message.channel,
			voiceChannel: voiceChannel,
			connection: null,
			songs: [],
			volume: 5,
			playing: true
		};

		// Set the queue for the server
		queue.set(guildId, queueConstruct);
		queueConstruct.songs.push(song);

		// Establish a connection and play the song
		voiceChannel
			.join()
			.then((connection) => {
				queueConstruct.connection = connection;
				play(message, song);
			})
			.catch(() => {
				console.log(err);
				queue.delete(guildId);
				return message.channel.send(err);
			});

	} else {
		serverQueue.songs.push(song);
		message.channel.send(`**${song.title}** has been added to the queue!`);
		logCurrentSong(serverQueue);
	}
};

const skip = (message, serverQueue) => {
	if (!message.member.voice.channel)
		return message.channel.send(
			"You have to be in a voice channel to stop the music!"
		);
	if (!serverQueue || (serverQueue && !serverQueue.connection && !serverQueue.connection.dispatcher))
		return message.channel.send("There is no song that I could skip!");

	message.channel.send(`Skipped song ${serverQueue.songs[0]}`);
	serverQueue.connection.dispatcher.end();
};

const play = async (message, song) => {
	const guildId = message.guild.id;
	const serverQueue = queue.get(guildId);

	if (!song) {
		logCurrentSong(null);
		serverQueue.voiceChannel.leave();
		queue.delete(guildId);
		return;
	}

	try {
		const dispatcher = serverQueue.connection
			.play(await (ytdl(song.url)), {type: 'opus'})
			.on("finish", () => {
				serverQueue.songs.shift();
				play(message, serverQueue.songs[0]);
			})
			.on("error", error => console.error(error))
		logCurrentSong(serverQueue);
		dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);
		serverQueue.textChannel.send(`Start playing: **${song.title}**`);
	} catch {
		logCurrentSong(serverQueue);
	}
};

const getSong = async (message, selecting, timeout = 10) => {
	const { content, member } = message;
	const userTag = member.user.tag;

	if (!content)
		return null;

	if (selecting) {
		const userId = member.user.id;
		const song = data[userId].get(content);
		delete data[userId];
		return song;
	} else {
		const cmdArgs = message.content
			.split(" ")
			.slice(1)
			.toString();
		if (cmdArgs.includes("www")) {
			return ytdl.getInfo(cmdArgs)
				.then((songInfo) => ({
					url: songInfo.url,
					title: songInfo.videoDetails.title.substring(80, 0),
					userTag: userTag
				}))
				.catch(() =>
					timeout ? getSong(message, selecting, timeout--) : null
				);
		} else {
			fetchYtSongs(message, cmdArgs);
			return null;
		}
	}
};

const fetchYtSongs = (message, song) => {
	const { user } = message.member;
	axios
		.get(
			"https://www.youtube.com/results?search_query=" +
			song.split(",").join("+") +
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
				return fetchYtSongs(message, song);
			}
			if (!records[0].videoRenderer) return fetchYtSongs(message, song);
			let count = 0;
			records.forEach(({videoRenderer: video}) => {
				if (!video) return;
				count++;
				const title = video.title.runs[0].text;
				const url =
					video.navigationEndpoint.commandMetadata.webCommandMetadata
						.url;
				// Set the songs in a map
				data[user.id].set(count.toString(), {
					title: decode(title).substring(80, 0),
					url: url,
					userTag: user.tag
				});
			});
			if (!data[user.id].keys().count)
				sendYtSongsToChannel(user.id, message.channel);
			return;
		});
	return;
};

const sendYtSongsToChannel = (userId, channel, start = 1, amount = 10) => {
	const end = start % 8;
	let str = "";

	for (let [key, value] of data[userId]) {
		if (start === amount * end) break;
		if (start == key) {
			str += `${key}.    **${value.title}**\n`;
			start++;
		}
	}

	if (str !== " " && str)
		channel.send(str);
};

const logCurrentSong = (serverQueue) => {
	process.stdout.cursorTo(0, 0);
	process.stdout.clearLine();
	if (!serverQueue) {
		console.log(clc.whiteBright.bold(clc.bgYellow("PENDING:") + " ..."));
	} else {
		const song = serverQueue.songs[0];
		console.log(
			clc.whiteBright.bold(
				clc.bgGreenBright("NOW PLAYING:") + " " + song.title
			) + ` (${clc.cyanBright(song.userTag)})`
		);
	}
	process.stdout.clearLine();
	console.log("------");
	for (let i = 1; i < 6; i++) {
		process.stdout.clearLine();
		try {
			const qsong = serverQueue.songs[i];
			console.log(
				clc.white.italic("↑. " + qsong.title) +
				` (${clc.cyanBright(qsong.userTag)})`
			);
		} catch {}
	}
	process.stdout.cursorTo(0, nrlogs);
};

const showQueue = (message, serverQueue) => {
	let msg = "";
	if (!serverQueue) {
		msg = "No music playing right now.\n";
	} else {
		const song = serverQueue.songs[0];
		msg = `**NOW PLAYING**: ***${song.title}*** (_${song.userTag}_)\n`;
	}
	msg += "------\n";
	if (serverQueue && serverQueue.songs.length > 1) {
		serverQueue.songs.forEach((song, i) => {
			if (i) msg += `↑. ***${song.title}*** (_${song.userTag}_)\n`;
		});
	}
	message.channel.send(msg);
}

client.login(token);
