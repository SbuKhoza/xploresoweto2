export const getIdentity = () => ({ kind: "web", hostname: typeof window !== "undefined" && window.location ? window.location.hostname : "" })
