const friendlyNames = {
    bsky: "bluesky",
    twitch: "twitch clips",
    generic: "other websites"
}

export const friendlyServiceName = (service) => {
    if (service in friendlyNames) {
        return friendlyNames[service];
    }
    return service;
}
