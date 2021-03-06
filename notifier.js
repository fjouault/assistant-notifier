var Client = require('castv2-client').Client;
var DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
var GoogleTTS = require('google-tts-api');
var request = require('request-promise-native');
var textToSpeech = require('@google-cloud/text-to-speech');
var fs = require('fs');
var util = require('util');

var AssistantNotifier = function(configuration) {
  this.host = configuration.host;
  this.voice = configuration.voice;
  this.volume = typeof configuration.volume === "undefined" ? -1 : configuration.volume;
}

AssistantNotifier.prototype.init = function(plugins) {
  var _this=this;
  this.plugins = plugins;
  if (!this.host) return Promise.reject("[assistant-notifier] Erreur : vous devez configurer ce plugin !");
  return Promise.resolve(this);
};

/**
 * Permet de passer sur un système de Promise plutôt que de callback
 *
 * @param  {Object} obj   Vraisemblablement il s'agit de "client"
 * @param  {String} fct   Le nom de la fonction de l'objet à appeler
 * @param  {Object|String} param Les paramètres associés
 * @return {Promise}
 */
AssistantNotifier.prototype.prom = function(obj, fct, param) {
  return new Promise(function(res, rej) {
    var callback = function(err, result) {
      if (err) rej(err);
      else res(result);
    }
    obj[fct](param || callback, callback);
  })
}

/**
 * Fonction appelée par le système central
 *
 * @param {String} text Le texte à lire (par exemple: "bonjour et bienvenue")
 */
AssistantNotifier.prototype.action = function(text) {
  var _this=this;
  return new Promise(function(prom_res) {
    // si 'text' commence par '{' alors ça veut dire qu'on veut envoyer à un Google Home bien précis
    text = text.trim();
    var gh=[], names = "tous les Google Home";
    if (text.startsWith('{')) {
      // on envoie à quelques Google Home
      names = text.split('}')[0].slice(1);
      gh = names.split(',').map(function(name) {  // on peut en spécifier plusieurs en les séparant par une virgule
        return _this.host[name.trim()]
      });
      text = text.split('}')[1].trim();
    } else {
      // on envoie à tous les Google Hom
      if (typeof _this.host === 'string') gh = [ _this.host ];
      else { // si pas un 'string', alors c'est un objet
        names = [];
        for (var h in _this.host) {
          names.push(h);
          gh.push(_this.host[h]);
        }
        names = names.join(',');
      }
    }

    const DEFAULT_CONTENT_TYPE = 'audio/mp3';
    var defaultNotification = true;
    var contentType = DEFAULT_CONTENT_TYPE;
    if(text.startsWith('[')) {
      contentType = text.split(']')[0].slice(1);
      text = text.split(']')[1].trim();
      defaultNotification = false;
    }

    console.log("[assistant-notifier] ("+names+") Lecture du message : "+text);

    // on génère le texte
    var currentVolume = {};
    _this.generateTTS(text)
    .then(function(url) {
      // pour chaque Google Home
      gh.forEach(function(host) {
        var client = new Client();
        currentVolume[host] = -1;
        _this.prom(client, 'connect', host)
        .then(function() {
          if (_this.volume > -1 && defaultNotification) {
            // on retrouve le volume courant
            return _this.prom(client, 'getVolume')
            .then(function(status) {
              currentVolume[host] = status.level;
              //console.log("[assistant-notifier] Le volume courant sur "+host+" est "+Math.round(currentVolume[host]*100)+"%");
              return _this.prom(client, 'setVolume', {level:_this.volume/100})
            })
          } else {
            return Promise.resolve();
          }
        })
        .then(function() {
          return _this.prom(client, 'launch', DefaultMediaReceiver)
        })
        .then(function(player) {
          var media = {
            contentId: url,
            contentType: contentType,
            streamType: 'BUFFERED'
          };
          player.load(media, {
            autoplay: true
          }, function(err, status) {
            player.on('status', function(status) {
              if (status.playerState == "IDLE") {
                if(defaultNotification) {
                  player.stop();
                }
                // si le volume était demandé, on le remet à la valeur d'origine
                if (currentVolume[host] > -1) {
                  //console.log("[assistant-notifier] On repasse le volume de "+host+" à "+Math.round(currentVolume[host]*100)+"%");
                  _this.prom(client, 'setVolume', {level:currentVolume[host]})
                  .then(function() {
                    client.close();
                    prom_res();
                  })
                } else {
                  client.close();
                  prom_res();
                }
              }
            });
          });
          if(!defaultNotification) {
            // terminate this action before the end of a possibly long-running stream,
            // but not for default notifications, and only after playing has had time to start
            setTimeout(function() {
              client.close();
              prom_res();
            }, 1000);
          }
        })
      })
    })
  })
};

/**
 * Génére un son à partir de texte, selon le service souhaité
 *
 * @param  {String} text
 * @return {Promise} Retourne l'URL vers le son qui sera lu par le Google Home
 */
AssistantNotifier.prototype.generateTTS = function(text) {
  // si le texte commence par "http" alors on le retourne car on considère que c'est déjà une URL
  if (text.toLowerCase().startsWith("http")) return Promise.resolve(text);
  if (!this.voice) {
    // si pas de voix, on utilise Google TTS
    return GoogleTTS(text, "fr-FR", 1);
  } else {
    // si une voix, on utilise le service associé
    return request({
      method:"POST",
      url: "https://assistant.kodono.info/notifier.php",
      body:JSON.stringify({
        d:{
          voice:this.voice,
          texte:text
        }
      })
    })
    .then(function(url) {
      return url;
    })
  }
}

/**
 * Initialisation du plugin
 *
 * @param  {Object} configuration La configuration
 * @param  {Object} plugins Un objet qui contient tous les plugins chargés
 * @return {Promise} resolve(this)
 */
exports.init=function(configuration, plugins) {
  return new AssistantNotifier(configuration).init(plugins)
  .then(function(resource) {
    console.log("[assistant-notifier] Plugin chargé et prêt.");
    return resource;
  })
}

