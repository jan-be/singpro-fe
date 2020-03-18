import Module from './pitchC.js';

let instance = {
    ready: new Promise(resolve => {
        Module({
            onRuntimeInitialized () {
                instance = Object.assign(this, {
                    ready: Promise.resolve()
                });
                resolve();
            }
        });
    })
};

export default {
    data () {
        return {
            result: null
        };
    },
    methods: {
        callGetPitch(a) {
            instance.ready
                .then(_ => this.result = instance._getPitch(a));
        }
    }
};
