const Discord = require('discord.js');
const {prefix, token} = require('./config.json');
const ytdl = require('ytdl-core');
const JSSoup = require('jssoup').default;
const urllib = require('urllib');
const decode = require('decode-html');
const axios = require('axios').default;

const client = new Discord.Client();

const queue = new Map();
const data = {};

client.once('ready', () => {
  console.log('Ready!');
});

client.once('reconnecting', () => {
  console.log('Reconnecting!');
});

client.once('disconnect', () => {
  console.log('Disconnect!');
});

client.on('message', async (message) => {
  if (message.author.bot) return;
  const userId = message.member.user.id;
  if (!(userId in data)) data[userId] = new Map();

  try {
    const serverQueue = queue.get(message.guild.id);
    if (data[userId].size > 0 && !message.content.startsWith(`${prefix}p`)) {
      if (message.content.startsWith('c')) {
        delete data[userId];
        message.channel.send('Canceled!');
      } else {
        execute(message, serverQueue, true);
      }
      return;
    } else if (message.content.startsWith(`${prefix}p`)) {
      execute(message, serverQueue);
      return;
    } else if (message.content.startsWith(`${prefix}s`)) {
      skip(message, serverQueue);
      return;
    } else if (message.content.startsWith(`${prefix}stop`)) {
      stop(message, serverQueue);
      return;
    } else if (message.content.startsWith(`${prefix}c`)) {
    } else if (!message.content.startsWith(prefix)) {
      return;
    } else {
      message.channel.send('You need to enter a valid command!');
    }
  } catch (e) {
    message.channel.send('Error occured: ' + e);
  }
});

async function execute(message, serverQueue, selecting = false) {
  var args;
  var url;
  const userId = message.member.user.id;
  if (userId in data && selecting) {
    const songTitle = data[userId].get(message.content).url;
    args = [0, songTitle];
    delete data[userId];
  } else {
    args = message.content.split(' ');
  }

  const voiceChannel = message.member.voice.channel;
  if (!voiceChannel)
    return message.channel.send(
      'You need to be in a voice channel to play music!'
    );

  const permissions = voiceChannel.permissionsFor(message.client.user);
  if (!permissions.has('CONNECT') || !permissions.has('SPEAK')) {
    return message.channel.send(
      'I need the permissions to join and speak in your voice channel!'
    );
  }

  if (selecting) {
    url = args[1].toString();
  } else {
    url = get_song(message, args.slice(1).toString());
  }

  if (url === '') {
    return;
  }

  const songInfo = await ytdl.getInfo(url);
  const song = {
    title: songInfo.title,
    url: songInfo.video_url,
  };

  if (!serverQueue) {
    const queueConstruct = {
      textChannel: message.channel,
      voiceChannel: voiceChannel,
      connection: null,
      songs: [],
      volume: 5,
      playing: true,
    };

    queue.set(message.guild.id, queueConstruct);

    queueConstruct.songs.push(song);

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
}

function skip(message, serverQueue) {
  if (!message.member.voice.channel)
    return message.channel.send(
      'You have to be in a voice channel to stop the music!'
    );
  if (!serverQueue)
    return message.channel.send('There is no song that I could skip!');
  serverQueue.connection.dispatcher.end();
}

function stop(message, serverQueue) {
  if (!message.member.voice.channel)
    return message.channel.send(
      'You have to be in a voice channel to stop the music!'
    );
  serverQueue.songs = [];
  serverQueue.connection.dispatcher.end();
}

function play(guild, song) {
  const serverQueue = queue.get(guild.id);
  if (!song) {
    serverQueue.voiceChannel.leave();
    queue.delete(guild.id);
    return;
  }

  const dispatcher = serverQueue.connection
    .play(ytdl(song.url, {filter: 'audioonly'})) //, {type: 'opus'})
    .on('finish', () => {
      serverQueue.songs.shift();
      play(guild, serverQueue.songs[0]);
    })
    .on('error', (error) => console.error(error));
  dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);
  serverQueue.textChannel.send(`Start playing: **${song.title}**`);
  console.log(`Start playing: **${song.title}**`);
}

function get_song(message, song, time = 0) {
  const channel = message.channel;
  const userId = message.member.user.id;
  console.log('Getting songs ' + time);

  if (song.includes('www')) {
    return song;
  }

  const searchString = song.split(',').join('+');

  axios
    .get(
      // urllib
      //   .request(
      'https://www.youtube.com/results?search_query=' +
        searchString +
        '&sp=EgIQAQ%253D%253D'
    )
    .then((result) => {
      const d = result.data.match(
        /(?<=window\["ytInitialData"\] = )(.+)(?=;)/gm
      );
      const jsondata = JSON.parse(d[0]);
      const records =
        jsondata.contents.twoColumnSearchResultsRenderer.primaryContents
          .sectionListRenderer.contents[0].itemSectionRenderer.contents;
      records.shift();
      for (let i = 0; i < records.length; i++) {
        const video = records[i].videoRenderer;
        const title = video.title.runs[0].text;
        const url =
          video.navigationEndpoint.commandMetadata.webCommandMetadata.url;
        // console.log(title);
        // console.log('https://www.youtube.com' + url);
        // console.log('-----');
        data[userId].set((i + 1).toString(), {title: decode(title), url: url});
        if (i === 9) {
          break;
        }
      }
      // OLD
      // var soup = new JSSoup(result.data);
      // var i = 1;
      // const v = soup.findAll('a', {
      //   id: 'video-title',
      //   title: !null,
      //   class: 'yt-simple-endpoint style-scope ytd-video-renderer',
      // });
      // console.log('Got songs');
      // for (let index = 0; index < v.length; index++) {
      //   const link = v[index];
      //   const href = link.attrs.href;
      //   const title = link.attrs.title;
      //   if (
      //     href !== undefined &&
      //     title !== undefined &&
      //     href.includes('/watch') &&
      //     !href.includes('list') &&
      //     !title.includes('/watch')
      //   ) {
      //     const url = 'https://www.youtube.com' + href;
      //     data[userId].set(i.toString(), {title: decode(title), url: url});
      //     i += 1;
      //     if (i === 10) {
      //       break;
      //     }
      //   }
      // }
      let str = '';
      data[userId].forEach((value, key, map) => {
        str += `${key}.    **${value.title}**\n`;
      });
      if (str !== ' ' && str) {
        channel.send(str);
      }
      return;
    });

  return '';
}
client.login(token);
