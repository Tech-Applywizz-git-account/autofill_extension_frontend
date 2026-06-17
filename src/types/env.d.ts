declare namespace NodeJS {
    interface ProcessEnv {
        REACT_APP_AI_URL: string;
        NODE_ENV: 'development' | 'production' | 'test';
    }
}
