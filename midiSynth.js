(function() {
	class MidiSynth {
		constructor() {
			// DOM refs
			this.messages = null;
			this.startBtn = null;
			this.status = null;

			// WebAudio refs
			this.audioContext = null;
			this.masterGainNode = null;
			this.masterFilter = null;

			// connected MIDI devices, keyed by name
			this.midiPorts = {};

			// currently-pressed keys, by MIDI note #
			this.pressedKeys = {};

			this.onMidiMessage = this.onMidiMessage.bind(this);
		}

		start() {
			this.messages = document.getElementById('messages');
			this.startBtn = document.getElementById('start');
			this.status = document.getElementById('status');

			if (!navigator.requestMIDIAccess) {
				this.logStatus('No MIDI support available.');
				this.disableStartBtn();
				return;
			}

			this.setupMidi();

			this.startBtn.addEventListener('click', this.onStartBtnClick.bind(this));
		}

		onStartBtnClick() {
			this.createAudio();
			this.disableStartBtn({ btnText: 'Synth Running' });
		}

		/*===== MIDI =====*/

		async setupMidi() {
			this.logStatus('Setting up MIDI...');

			try {
				const access = await navigator.requestMIDIAccess();
				access.addEventListener('statechange', this.onStateChange.bind(this));
				access.inputs.forEach(this.enableMidiInput.bind(this));
			} catch(e) {
				this.logStatus('Error setting up MIDI: ' + e.message);
			}
		}

		onStateChange({ port }) {
			this.logStatus(`State change: ${port.name}, ${port.state}`);

			if (port.type === 'input') {
				switch (port.state) {
					case 'connected':
						this.enableMidiInput(port);
						break;

					case 'disconnected':
						this.disableMidiInput(port);
						break;
				}
			}
		}

		enableMidiInput(input = {}) {
			if (this.midiPorts[input.name]) { return; }

			this.logStatus(`Enabling MIDI input: '${input.name}'`);
			input.addEventListener('midimessage', this.onMidiMessage);

			this.midiPorts[input.name] = input;
		}

		disableMidiInput(input = {}) {
			if (!this.midiPorts[input.name]) { return; }

			this.logStatus(`Disabling MIDI input: '${input.name}'`);
			input.removeEventListener('midimessage', this.onMidiMessage);

			delete this.midiPorts[input.name];
		}

		onMidiMessage(message = {}) {
			this.printMessageInfo(message);

			const [statusByte, data1, data2] = message.data;

			if (this.isNoteOn(statusByte)) {
				this.playNote(data1, data2);

			} else if (this.isNoteOff(statusByte)) {
				this.stopNote(data1);

			// https://www.midi.org/specifications-old/item/table-3-control-change-messages-data-bytes-2
			} else if (statusByte === 176) {
				switch(data1) {
						// modulation
					case 1:
						break;

						// volume
					case 7:
						this.setMasterGain(data2 / 127);
						break;
				}

			} else if (statusByte === 224) {
				// pitch bend
				this.setMasterFilterFreq(data2);
			}
		}

		isNoteOn(statusByte) {
			return (statusByte >= 144 && statusByte <= 159);
		}

		isNoteOff(statusByte) {
			return (statusByte >= 128 && statusByte <= 143);
		}

		// https://en.wikipedia.org/wiki/MIDI_tuning_standard#Frequency_values
		midiNoteToFreq(note) {
			return Math.pow(2, (note - 69) / 12) * 440;
		}

		midiVelocityToGain(velocity) {
			return Math.log(Math.pow(10, velocity)) / 292.4283068102438;
		}


		/*===== WebAudio =====*/

		createAudio() {
			this.logStatus('Starting AudioContext...');

			const ACtx = window.AudioContext || window.webkitAudioContext;
			if (!ACtx) {
				this.logStatus('No constructor for AudioContext found.');
				return;
			}

			this.audioContext = new ACtx();

			this.masterGainNode = this.audioContext.createGain();
			this.masterGainNode.gain.value = 0.5;

			this.masterFilter = this.createFilter();

			this.masterGainNode.connect(this.masterFilter);
			this.masterFilter.connect(this.audioContext.destination);
		}

		createFilter() {
			const filter = this.audioContext.createBiquadFilter();
			filter.type = 'lowpass';
			filter.frequency.value = 1000;
			filter.Q.value = 8;
			return filter;
		}

		playNote(note, velocity) {
			if (!this.audioContext) { return; }

			const freq = this.midiNoteToFreq(note);
			const osc = this.createOscillator(freq);

			const gainVal = this.midiVelocityToGain(velocity);
			const gainNode = this.createGain(gainVal);
			osc.connect(gainNode);

			this.pressedKeys[note] = osc;
			osc.start();
		}

		stopNote(note) {
			let osc = this.pressedKeys[note];
			if (!osc) { return; }

			osc.stop();
			delete this.pressedKeys[note];
			osc = null;
		}

		createOscillator(frequency) {
			const osc = this.audioContext.createOscillator();
			osc.type = 'square';
			osc.frequency.value = frequency;
			return osc;
		}

		createGain(value) {
			const gainNode = this.audioContext.createGain();
			gainNode.connect(this.masterGainNode);
			gainNode.gain.value = value;
			return gainNode;
		}

		setMasterGain(value) {
			if (this.masterGainNode) {
				this.masterGainNode.gain.value = value;
			}
		}

		setMasterFilterFreq(data) {
			if (this.masterFilter) {
				this.masterFilter.frequency.value = (data / 64) * 1000;
			}
		}

		/*===== UI and such =====*/

		printMessageInfo({ data, target }) {
			let noteFreq = '';
			if (this.isNoteOn(data[0]) || this.isNoteOff(data[0])) {
				noteFreq = `(${this.midiNoteToFreq(data[1])})`;
			}

			this.messages.innerText = `
=====================
${target.name}
---------------------
Status: ${data[0]}
Data 1: ${data[1]} ${noteFreq}
Data 2: ${data[2]}
=====================
	`;
		}

		logStatus(message = '') {
			/*eslint-disable no-console*/
			console.log(message);
			/*eslint-enable no-console*/
			this.status.innerText += `${message}\n`;
		}

		disableStartBtn({ btnText }) {
			this.startBtn.setAttribute('disabled', 'disabled');
			if (btnText) {
				this.startBtn.innerText = btnText;
			}
		}
	}

	// wait for it...
	document.addEventListener('DOMContentLoaded', () => {
		const ms = new MidiSynth();
		ms.start();
	});

})();
