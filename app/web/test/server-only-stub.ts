// Test stand-in for the 'server-only' marker package: importing the
// real one outside a React server bundle throws, which would make
// every lib module untestable in plain Node.
export {};
