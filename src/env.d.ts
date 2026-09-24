declare const __APP_VERSION__: string;

declare module '*.txt' {
    const content: string;
    export default content;
}
