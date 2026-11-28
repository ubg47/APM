
const yandexGamesSDK = (function () {

    let m_sdk = null;
    let m_payments = null;
    let m_player = null;

    let m_initialized = false;
    let m_standalone = false;
    let m_initializing = null;

    let m_bannerVisible = false;
    let m_interstitialVisible = false;
    let m_rewardedVisible = false;

    let m_cacheProductsData = "[]";
    let m_cachePurchasesData = "[]";

    const m_jsonContainers = [
        "json-data",
        "write-experiment",
        "cryptography"
    ];

    let m_cacheContainers = {};

    const STORAGE_KEY = "APM_MIRRA_SAVES";

    // ----------------------------------
    // UNITY CALLBACKS
    // ----------------------------------

    function m_trySendMessage(objectName, methodName, value) {
        try {
            if (
                typeof game !== "undefined" &&
                game &&
                typeof game.getInstance === "function"
            ) {
                const instance = game.getInstance();

                if (instance && typeof instance.SendMessage === "function") {
                    instance.SendMessage(
                        objectName,
                        methodName,
                        value
                    );
                }
            }
        } catch (error) {
            console.warn("[APM SDK] Unity callback unavailable:", error);
        }
    }

    function m_callback(eventSource, eventType) {
        m_trySendMessage("JSCallbacks", eventSource, eventType);
    }

    // ----------------------------------
    // LOCAL SAVE STORAGE
    // ----------------------------------

    function m_loadLocalSaves() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);

            if (saved) {
                m_cacheContainers = JSON.parse(saved);
            }
        } catch (error) {
            console.warn("[APM SDK] Could not load local saves:", error);
        }

        for (const container of m_jsonContainers) {
            if (m_cacheContainers[container] == null) {
                m_cacheContainers[container] = "Empty";
            }
        }

        return m_cacheContainers;
    }

    function m_saveLocalSaves() {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(m_cacheContainers)
            );

            return true;
        } catch (error) {
            console.error("[APM SDK] Could not save data:", error);
            return false;
        }
    }

    // ----------------------------------
    // SDK INITIALIZATION
    // ----------------------------------

    function m_init() {

        if (m_initialized) {
            return Promise.resolve(m_sdk);
        }

        if (m_initializing) {
            return m_initializing;
        }

        m_initializing = (async function () {

            console.log("[APM SDK] Initializing...");

            const isYandexEnvironment =
                window.parent !== window &&
                typeof window.YandexGamesSDKEnvironment !== "undefined";

            if (!isYandexEnvironment) {

                console.log("[APM SDK] Standalone mode enabled.");

                m_standalone = true;
                m_initialized = true;

                m_loadLocalSaves();

                m_cacheProductsData = "[]";
                m_cachePurchasesData = "[]";

                return null;
            }

            try {

                if (!window.YaGames) {

                    await new Promise((resolve, reject) => {

                        const script = document.createElement("script");

                        script.src = "https://yandex.ru/games/sdk/v2";

                        script.onload = resolve;

                        script.onerror = () => reject(
                            new Error("Could not load Yandex SDK")
                        );

                        document.head.appendChild(script);
                    });
                }

                m_sdk = await YaGames.init();

                console.log("[APM SDK] Yandex initialized.");

                m_initialized = true;

                // Payments are optional.
                try {
                    m_payments = await m_sdk.getPayments();

                    await m_cacheServerProducts();
                    await m_cacheServerPurchases();

                } catch (error) {
                    console.warn(
                        "[APM SDK] Payments unavailable:",
                        error
                    );

                    m_payments = null;
                    m_cacheProductsData = "[]";
                    m_cachePurchasesData = "[]";
                }

                // Player and cloud saves are optional.
                try {
                    m_player = await m_sdk.getPlayer({
                        scopes: false
                    });

                    await m_resolveSaves();

                } catch (error) {
                    console.warn(
                        "[APM SDK] Player unavailable:",
                        error
                    );

                    m_loadLocalSaves();
                }

                return m_sdk;

            } catch (error) {

                console.warn(
                    "[APM SDK] Yandex unavailable. Using standalone mode:",
                    error
                );

                m_sdk = null;
                m_payments = null;
                m_player = null;

                m_standalone = true;
                m_initialized = true;

                m_loadLocalSaves();

                return null;
            }

        })();

        return m_initializing;
    }

    // ----------------------------------
    // LANGUAGE
    // ----------------------------------

    function m_resolveLanguage() {

        if (
            m_sdk &&
            m_sdk.environment &&
            m_sdk.environment.i18n
        ) {
            return m_sdk.environment.i18n.lang || "en";
        }

        const language =
            navigator.language ||
            navigator.userLanguage ||
            "en";

        return language.split("-")[0].toLowerCase();
    }

    // ----------------------------------
    // BANNERS
    // ----------------------------------

    async function m_refreshBannerStatus() {

        if (!m_sdk || m_standalone) {
            m_bannerVisible = false;
            return false;
        }

        try {
            const result = await m_sdk.adv.getBannerAdvStatus();

            m_bannerVisible = result.stickyAdvIsShowing;

            return m_bannerVisible;

        } catch (error) {
            console.warn("[APM SDK] Banner status failed:", error);
            return false;
        }
    }

    async function m_invokeBanner() {

        if (!m_sdk || m_standalone) {
            return false;
        }

        try {
            await m_sdk.adv.showBannerAdv();
            return await m_refreshBannerStatus();

        } catch (error) {
            console.warn("[APM SDK] Banner unavailable:", error);
            return false;
        }
    }

    async function m_disableBanner() {

        if (!m_sdk || m_standalone) {
            m_bannerVisible = false;
            return false;
        }

        try {
            await m_sdk.adv.hideBannerAdv();
            m_bannerVisible = false;
            return true;

        } catch (error) {
            console.warn("[APM SDK] Banner hide failed:", error);
            return false;
        }
    }

    // ----------------------------------
    // INTERSTITIAL ADS
    // ----------------------------------

    function m_invokeInterstitial() {

        if (!m_sdk || m_standalone) {
            console.log("[APM SDK] Interstitial skipped.");
            m_interstitialVisible = false;
            m_callback("OnInterstitialEvent", "Error");
            m_callback("OnInterstitialEvent", "Close");
            return Promise.resolve(false);
        }

        return new Promise(resolve => {

            try {

                m_sdk.adv.showFullscreenAdv({

                    callbacks: {

                        onOpen: function () {
                            m_interstitialVisible = true;
                            m_callback("OnInterstitialEvent", "Begin");
                        },

                        onClose: function () {
                            m_interstitialVisible = false;
                            m_callback("OnInterstitialEvent", "Close");
                            resolve(true);
                        },

                        onError: function (error) {
                            console.warn("[APM SDK] Interstitial error:", error);

                            m_interstitialVisible = false;

                            m_callback("OnInterstitialEvent", "Error");
                            resolve(false);
                        },

                        onOffline: function () {
                            m_interstitialVisible = false;
                            m_callback("OnInterstitialEvent", "Offline");
                            resolve(false);
                        }
                    }
                });

            } catch (error) {

                console.warn("[APM SDK] Interstitial failed:", error);

                m_interstitialVisible = false;
                m_callback("OnInterstitialEvent", "Error");

                resolve(false);
            }
        });
    }

    // ----------------------------------
    // REWARDED ADS
    // ----------------------------------

    function m_invokeRewarded() {

        if (!m_sdk || m_standalone) {

            console.log("[APM SDK] Rewarded ad skipped.");

            m_rewardedVisible = false;

            m_callback("OnRewardedEvent", "Error");
            m_callback("OnRewardedEvent", "Close");

            return Promise.resolve(false);
        }

        return new Promise(resolve => {

            let rewarded = false;

            try {

                m_sdk.adv.showRewardedVideo({

                    callbacks: {

                        onOpen: function () {
                            m_rewardedVisible = true;
                            m_callback("OnRewardedEvent", "Begin");
                        },

                        onRewarded: function () {
                            rewarded = true;
                            m_callback("OnRewardedEvent", "Success");
                        },

                        onClose: function () {
                            m_rewardedVisible = false;
                            m_callback("OnRewardedEvent", "Close");
                            resolve(rewarded);
                        },

                        onError: function (error) {
                            console.warn("[APM SDK] Rewarded ad error:", error);

                            m_rewardedVisible = false;

                            m_callback("OnRewardedEvent", "Error");

                            resolve(false);
                        }
                    }
                });

            } catch (error) {

                console.warn("[APM SDK] Rewarded ad failed:", error);

                m_rewardedVisible = false;
                m_callback("OnRewardedEvent", "Error");

                resolve(false);
            }
        });
    }

    // ----------------------------------
    // PAYMENTS
    // ----------------------------------

    async function m_cacheServerProducts() {

        if (!m_payments) {
            m_cacheProductsData = "[]";
            return [];
        }

        try {

            const products = await m_payments.getCatalog();

            const result = products.map(product => ({
                productTag: product.id,
                priceValue: product.priceValue
            }));

            m_cacheProductsData = JSON.stringify(result);

            m_callback("OnResolveProducts", "Success");

            return products;

        } catch (error) {

            console.warn("[APM SDK] Products unavailable:", error);

            m_cacheProductsData = "[]";

            m_callback("OnResolveProducts", "Error");

            return [];
        }
    }

    async function m_cacheServerPurchases() {

        if (!m_payments) {
            m_cachePurchasesData = "[]";
            return [];
        }

        try {

            const purchases = await m_payments.getPurchases();

            const result = purchases.map(purchase => ({
                productTag: purchase.productID
            }));

            m_cachePurchasesData = JSON.stringify(result);

            m_callback("OnResolvePurchases", "Success");

            return purchases;

        } catch (error) {

            console.warn("[APM SDK] Purchases unavailable:", error);

            m_cachePurchasesData = "[]";

            m_callback("OnResolvePurchases", "Error");

            return [];
        }
    }

    async function m_invokePurchase(productTag) {

        if (!m_payments || m_standalone) {

            console.warn("[APM SDK] Purchases unavailable.");

            m_callback("OnPurchaseEvent", "Error");

            return false;
        }

        try {

            await m_payments.purchase(productTag);

            m_callback("OnPurchaseEvent", "Success");

            return true;

        } catch (error) {

            console.warn("[APM SDK] Purchase failed:", error);

            m_callback("OnPurchaseEvent", "Error");

            return false;
        }
    }

    // ----------------------------------
    // PLAYER AND SAVES
    // ----------------------------------

    async function m_resolveSaves() {

        if (m_standalone || !m_player) {

            m_loadLocalSaves();

            m_callback("OnResolveSaves", "Success");

            return m_cacheContainers;
        }

        try {

            const data = await m_player.getData(m_jsonContainers);

            for (const container of m_jsonContainers) {

                m_cacheContainers[container] =
                    data[container] != null
                        ? data[container]
                        : "Empty";
            }

            m_callback("OnResolveSaves", "Success");

            return data;

        } catch (error) {

            console.warn("[APM SDK] Cloud saves unavailable:", error);

            m_loadLocalSaves();

            m_callback("OnResolveSaves", "Success");

            return m_cacheContainers;
        }
    }

    async function m_writeSaves() {

        if (m_standalone || !m_player) {

            const success = m_saveLocalSaves();

            m_callback(
                "OnWriteSaves",
                success ? "Success" : "Error"
            );

            return success;
        }

        try {

            const data = {};

            for (const container of m_jsonContainers) {
                data[container] = m_cacheContainers[container];
            }

            const cryptography = new Uint32Array(8);

            if (window.crypto && window.crypto.getRandomValues) {
                window.crypto.getRandomValues(cryptography);
            }

            data.cryptography = Array.from(cryptography);

            await m_player.setData(data, true);

            m_callback("OnWriteSaves", "Success");

            return true;

        } catch (error) {

            console.warn("[APM SDK] Cloud save failed:", error);

            m_saveLocalSaves();

            m_callback("OnWriteSaves", "Error");

            return false;
        }
    }

    function m_writeCacheSavesJSON(containerTag, json) {

        if (!m_jsonContainers.includes(containerTag)) {
            console.warn("[APM SDK] Unknown save container:", containerTag);
            return;
        }

        m_cacheContainers[containerTag] = json;

        if (m_standalone) {
            m_saveLocalSaves();
        }
    }

    // ----------------------------------
    // PUBLIC API
    // ----------------------------------

    return {

        getSDK: function () {
            return m_sdk;
        },

        init: function () {
            return m_init();
        },

        isBannerVisible: function () {
            return m_bannerVisible;
        },

        invokeBanner: function () {
            return m_invokeBanner();
        },

        disableBanner: function () {
            return m_disableBanner();
        },

        isInterstitialVisible: function () {
            return m_interstitialVisible;
        },

        invokeInterstitial: function () {
            return m_invokeInterstitial();
        },

        isRewardedVisible: function () {
            return m_rewardedVisible;
        },

        invokeRewarded: function () {
            return m_invokeRewarded();
        },

        invokePurchase: function (productTag) {
            return m_invokePurchase(productTag);
        },

        resolveServerProducts: function () {
            return m_cacheServerProducts();
        },

        resolveServerPurchases: function () {
            return m_cacheServerPurchases();
        },

        resolveCacheProducts: function () {
            return m_cacheProductsData;
        },

        resolveCachePurchases: function () {
            return m_cachePurchasesData;
        },

        resolveSaves: function () {
            return m_resolveSaves();
        },

        writeSaves: function () {
            return m_writeSaves();
        },

        resolveCacheSavesJSON: function (containerTag) {

            const value = m_cacheContainers[containerTag];

            return value == null ? "Empty" : value;
        },

        writeCacheSavesJSON: function (containerTag, json) {
            return m_writeCacheSavesJSON(containerTag, json);
        },

        resolveLanguage: function () {
            return m_resolveLanguage();
        }

    };

})();
