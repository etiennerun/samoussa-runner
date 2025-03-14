// Gestionnaire audio amélioré avec Web Audio API pour Samoussa Runner
const AudioManager = {
    // État du système
    isMuted: false,
    isInitialized: false,
    context: null,
    masterGain: null,
    sounds: {},
    music: null,
    currentMusicPath: null,
    resumeAudioOnFocus: false,
    musicBuffer: null,      // AJOUTEZ CETTE LIGNE
    musicSource: null,      // ET CETTE LIGNE
    
    // Initialiser le système audio avec Web Audio API
    init: function() {
        try {
            // Créer le contexte audio (plus performant que les éléments Audio)
            // L'AudioContext va nous permettre un contrôle beaucoup plus précis
            window.AudioContext = window.AudioContext || window.webkitAudioContext;
            this.context = new AudioContext();
            
            // Créer un noeud de gain principal pour contrôler le volume global
            this.masterGain = this.context.createGain();
            this.masterGain.gain.value = 0.7; // 70% du volume
            this.masterGain.connect(this.context.destination);
            
            console.log("Contexte audio initialisé avec succès");
            this.isInitialized = true;
            
            // Précharger les effets sonores
            this.loadSound('jump', 'sounds/jump.mp3');
            this.loadSound('collect', 'sounds/collect.mp3');
            this.loadSound('crash', 'sounds/crash.mp3');
            this.loadSound('levelUp', 'sounds/level-up.mp3');
            this.loadSound('powerup', 'sounds/powerup.mp3');
            this.loadSound('hintDouble', 'sounds/hint-double.mp3'); // Son pour l'indice de double saut rapide
            this.loadSound('hintLong', 'sounds/hint-long.mp3');     // Son pour l'indice de saut long
            
            // Configurer le contrôle du son
            this.setupSoundControls();
            
            // Gérer les événements de visibilité de la page
            this.setupVisibilityHandlers();
            
            // Gérer les interactions tactiles pour iOS
            this.unlockAudioOnUserInteraction();
            
            // Charger la préférence utilisateur
            this.loadSoundPreference();
        } catch (e) {
            console.error("Erreur lors de l'initialisation du système audio:", e.message);
            // Système de secours en cas d'échec de Web Audio API
            this.setupFallbackAudio();
        }
    },
    
    // Configurer les contrôles du son à l'écran
setupSoundControls: function() {
    const soundIcon = document.getElementById('sound-icon');
    if (!soundIcon) return;
    
    // Supprimer les anciens gestionnaires d'événements pour éviter les conflits
    soundIcon.removeEventListener('click', this.handleToggle);
    soundIcon.removeEventListener('touchend', this.handleToggle);
    soundIcon.removeEventListener('touchstart', this.handleToggle);
    
    // Définir la fonction de gestion
    this.handleToggle = (event) => {
        event.stopPropagation();
        event.preventDefault();
        
        this.toggleMute();
        soundIcon.src = this.isMuted ? 'assets/sound-off.png' : 'assets/sound-on.png';
        soundIcon.alt = this.isMuted ? 'Son désactivé' : 'Son activé';
    };
    
    // Ajouter les événements avec différentes stratégies pour maximiser la compatibilité
    soundIcon.addEventListener('click', this.handleToggle, true);
    soundIcon.addEventListener('touchstart', this.handleToggle, { passive: false, capture: true });
    soundIcon.addEventListener('touchend', this.handleToggle, { passive: false, capture: true });
    
    // Empêcher la propagation sur le conteneur audio entier
    const audioControls = document.getElementById('audio-controls');
    if (audioControls) {
        audioControls.addEventListener('click', e => e.stopPropagation(), true);
        audioControls.addEventListener('touchstart', e => e.stopPropagation(), { passive: false, capture: true });
        audioControls.addEventListener('touchend', e => e.stopPropagation(), { passive: false, capture: true });
    }
},
    
    // Gérer les changements de visibilité (app en arrière-plan, veille, etc.)
    setupVisibilityHandlers: function() {
        // Mettre en pause quand l'application n'est plus visible
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.pauseAll();
                this.resumeAudioOnFocus = !this.isMuted;
            } else if (this.resumeAudioOnFocus) {
                this.resumeAll();
            }
        });
        
        // Mettre en pause quand l'application perd le focus (changement d'app)
        window.addEventListener('blur', () => {
            this.pauseAll();
            this.resumeAudioOnFocus = !this.isMuted;
        });
        
        // Reprendre quand l'application récupère le focus
        window.addEventListener('focus', () => {
            if (this.resumeAudioOnFocus) {
                this.resumeAll();
            }
        });
        
        // Gérer la reprise après suspension (iOS)
        window.addEventListener('pageshow', (event) => {
            if (event.persisted && this.resumeAudioOnFocus) {
                // La page a été restaurée depuis le cache bfcache
                setTimeout(() => this.resumeAll(), 200); // Délai pour éviter les bugs iOS
            }
        });
    },
    
    // Débloquer l'audio sur la première interaction utilisateur (requis par iOS)
    unlockAudioOnUserInteraction: function() {
        const unlockAudio = () => {
            if (!this.isInitialized || this.context.state === 'running') return;
            
            // Essayer de reprendre le contexte audio
            this.context.resume().then(() => {
                console.log("Contexte audio débloqué avec succès");
                
                // Jouer la musique si nécessaire
                if (this.currentMusicPath && !this.isMuted) {
                    this.playMusic(this.currentMusicPath);
                }
            }).catch(err => {
                console.error("Impossible de débloquer l'audio:", err);
            });
        };
        
        // Événements qui peuvent débloquer l'audio
        const unlockEvents = ['touchstart', 'touchend', 'click', 'keydown'];
        unlockEvents.forEach(eventType => {
            document.addEventListener(eventType, unlockAudio, { once: true });
        });
    },
    
    // Charger un fichier audio
    loadSound: function(name, path) {
        // Utiliser un cache pour éviter de charger plusieurs fois le même son
        if (!this.isInitialized) return;
        
        fetch(path)
            .then(response => response.arrayBuffer())
            .then(arrayBuffer => this.context.decodeAudioData(arrayBuffer))
            .then(audioBuffer => {
                this.sounds[name] = audioBuffer;
                console.log(`Son '${name}' chargé avec succès`);
            })
            .catch(error => {
                console.error(`Erreur lors du chargement du son '${name}':`, error);
            });
    },
    
    // Jouer un effet sonore
    playSound: function(name, volume = 0.7) {
        if (this.isMuted || !this.isInitialized || !this.sounds[name]) return;
        
        try {
            // Créer une source sonore à partir du buffer
            const source = this.context.createBufferSource();
            source.buffer = this.sounds[name];
            
            // Créer un gain individuel pour ce son
            const gainNode = this.context.createGain();
            gainNode.gain.value = volume;
            
            // Connecter la source au gain puis au master
            source.connect(gainNode);
            gainNode.connect(this.masterGain);
            
            // Jouer le son (cette méthode est beaucoup plus réactive)
            source.start(0);
            
            return source; // Retourner la source pour pouvoir l'arrêter si besoin
        } catch (e) {
            console.error(`Erreur lors de la lecture du son '${name}':`, e);
            return null;
        }
    },
    
    // Jouer la musique de fond
    playMusic: function(path) {
    if (this.isMuted || !this.isInitialized) return;
    
    this.currentMusicPath = path;
    
    // Si nous n'avons pas encore chargé cette musique en buffer
    if (!this.musicBuffer) {
        // Afficher une notification de chargement en cours (optionnel)
        console.log("Chargement de la musique en cours...");
        
        // Charger le fichier audio en tant que buffer (meilleure performance)
        fetch(path)
            .then(response => response.arrayBuffer())
            .then(arrayBuffer => this.context.decodeAudioData(arrayBuffer))
            .then(audioBuffer => {
                this.musicBuffer = audioBuffer;
                this.playMusicFromBuffer();
                console.log("Musique chargée et en lecture");
            })
            .catch(error => {
                console.error("Erreur lors du chargement de la musique:", error);
                // Fallback sur la méthode simple en cas d'erreur
                this.playMusicFallback(path);
            });
    } else {
        // Si le buffer est déjà chargé, jouer directement
        this.playMusicFromBuffer();
    }
},
    
    playMusicFromBuffer: function() {
    if (!this.musicBuffer || this.isMuted) return;
    
    // Petite pause avant de démarrer une nouvelle source audio
    // pour éviter les problèmes de tressautement
    setTimeout(() => {
        // Arrêter la source précédente si elle existe
        if (this.musicSource) {
            try {
                this.musicSource.stop();
                this.musicSource.disconnect();
            } catch (e) {
                // Ignorer les erreurs si la source est déjà arrêtée
            }
            this.musicSource = null; // S'assurer que la référence est bien effacée
        }
        
        // Créer une nouvelle source à partir du buffer avec un petit délai
        try {
            this.musicSource = this.context.createBufferSource();
            
            // IMPORTANT: Définir le buffer d'abord
            this.musicSource.buffer = this.musicBuffer;
            
            // Définir les propriétés de boucle
            this.musicSource.loop = true;
            
            // Créer un nœud de gain pour contrôler le volume
            const gainNode = this.context.createGain();
            gainNode.gain.value = 0.4; // 40% du volume
            
            // Ajouter un petit fade-in pour éviter les clics/pops audio
            gainNode.gain.setValueAtTime(0, this.context.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.4, this.context.currentTime + 0.1);
            
            // Connecter la source au gain puis au master
            this.musicSource.connect(gainNode);
            gainNode.connect(this.masterGain);
            
            // Démarrer la lecture
            this.musicSource.start(0);
            
            console.log(`Boucle musicale démarrée, durée: ${this.musicBuffer.duration.toFixed(2)}s`);
        } catch (e) {
            console.error("Erreur lors du démarrage de la musique:", e);
        }
    }, 100); // Délai de 100ms avant de redémarrer la musique
},

// Méthode de secours si le chargement du buffer échoue
playMusicFallback: function(path) {
    try {
        // Utiliser un élément Audio standard pour la musique de fond
        if (this.music) {
            this.music.pause();
        }
        
        this.music = new Audio(path);
        this.music.loop = true;
        this.music.volume = 0.4;
        this.music.play().catch(e => {
            console.warn("Impossible de jouer la musique en mode secours:", e);
        });
    } catch (e) {
        console.error("Erreur lors de la lecture de la musique en mode secours:", e);
    }
},
    
    // Mettre en pause tous les sons
   pauseAll: function() {
    if (this.music) {
        this.music.pause();
    }
    
    // Arrêter la source musicale du buffer si elle existe
    if (this.musicSource) {
        try {
            this.musicSource.stop();
        } catch (e) {
            // Ignorer les erreurs si la source est déjà arrêtée
        }
    }
    
    // Suspendre le contexte audio (arrête tous les sons)
    if (this.isInitialized && this.context.state === 'running') {
        this.context.suspend();
    }
},
    
   // Reprendre tous les sons
resumeAll: function() {
    if (this.isMuted) return;
    
    // Petit délai pour laisser iOS initialiser l'audio correctement
    setTimeout(() => {
        // Reprendre le contexte audio
        if (this.isInitialized && this.context.state === 'suspended') {
            this.context.resume()
                .then(() => {
                    console.log("Contexte audio repris avec succès");
                    
                    // Rejouer la musique du buffer si nécessaire
                    if (this.musicBuffer && this.currentMusicPath) {
                        // Vérifier si la source existe et joue déjà
                        if (!this.musicSource || this.musicSource.playbackState === 'finished') {
                            this.playMusicFromBuffer();
                        }
                    }
                })
                .catch(err => console.error("Erreur lors de la reprise du contexte audio:", err));
        }
        
        // Reprendre la musique si elle existait (méthode de secours)
        if (this.music && this.currentMusicPath && !this.musicBuffer) {
            this.music.play().catch(e => {
                console.warn("Impossible de reprendre la musique:", e);
                // Tenter de recharger et rejouer si la première tentative échoue
                this.music.load();
                this.music.play().catch(e2 => console.error("Deuxième tentative échouée"));
            });
        }
    }, 300); // Délai de 300ms
},
    
    // Activer/désactiver tous les sons
    toggleMute: function() {
        this.isMuted = !this.isMuted;
        
        if (this.isMuted) {
            this.pauseAll();
        } else {
            this.resumeAll();
        }
        
        // Sauvegarder la préférence utilisateur
        try {
            localStorage.setItem('wayowayoSoundMuted', this.isMuted.toString());
        } catch (e) {
            console.warn("Impossible de sauvegarder la préférence de son:", e);
        }
        
        return this.isMuted;
    },
    
    // Charger la préférence son de l'utilisateur
    loadSoundPreference: function() {
        try {
            const savedMute = localStorage.getItem('wayowayoSoundMuted');
            if (savedMute !== null) {
                this.isMuted = savedMute === 'true';
                
                // Mettre à jour l'icône
                const soundIcon = document.getElementById('sound-icon');
                if (soundIcon) {
                    soundIcon.src = this.isMuted ? 'assets/sound-off.png' : 'assets/sound-on.png';
                    soundIcon.alt = this.isMuted ? 'Son désactivé' : 'Son activé';
                }
            }
        } catch (e) {
            console.warn("Impossible de charger la préférence de son:", e);
        }
    },
    
    // Système de secours si Web Audio API échoue
    setupFallbackAudio: function() {
        console.log("Utilisation du système audio de secours");
        
        // Utiliser la méthode traditionnelle avec les éléments Audio
        this.isInitialized = true;
        this.sounds = {};
        
        // Précharger les sons avec la méthode traditionnelle
        const soundNames = ['jump', 'collect', 'crash', 'levelUp', 'powerup'];
        soundNames.forEach(name => {
            this.sounds[name] = new Audio(`sounds/${name}.mp3`);
            this.sounds[name].preload = 'auto';
        });
        
        // Remplacer la méthode playSound par une version simplifiée
        this.originalPlaySound = this.playSound;
        this.playSound = function(name) {
            if (this.isMuted || !this.sounds[name]) return;
            
            try {
                // Cloner le son pour permettre plusieurs instances
                const sound = this.sounds[name].cloneNode();
                sound.volume = 0.7;
                sound.play();
            } catch (e) {
                console.error(`Erreur lors de la lecture du son de secours '${name}':`, e);
            }
        };
        
        // Adapter les autres méthodes au système de secours
        this.originalPlayMusic = this.playMusic;
        this.playMusic = function(path) {
            if (this.isMuted) return;
            
            this.currentMusicPath = path;
            
            if (this.music) {
                this.music.pause();
            }
            
            this.music = new Audio(path);
            this.music.loop = true;
            this.music.volume = 0.4;
            this.music.play().catch(e => console.warn("Autoplay prevented in fallback mode"));
        };
    }
};

// Initialiser le système audio lors du chargement
document.addEventListener('DOMContentLoaded', function() {
    console.log("Initialisation du système audio...");
    AudioManager.init();
});