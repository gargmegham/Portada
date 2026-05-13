(function () {
    /**
     * @typedef {Object} Response
     * @property {boolean} success
     * @property {any} [data]
     * @property {string} [errorCode]
     * @property {string} [message]
     */

    /**
     * @type {import('@skystream/sdk').Manifest}
     */
    // var manifest is injected at runtime

    async function getHome(cb) {
        cb({ success: true, data: {} });
    }

    async function search(query, cb) {
        cb({ success: true, data: [] });
    }

    async function load(url, cb) {
        cb({
            success: false,
            errorCode: "NOT_IMPLEMENTED",
            message: "Portada is scaffold-only at this stage. Sources will be added later."
        });
    }

    async function loadStreams(url, cb) {
        cb({
            success: false,
            errorCode: "NOT_IMPLEMENTED",
            message: "Portada is scaffold-only at this stage. Sources will be added later."
        });
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();

