// import { createServer } from "esbuild-server";
import copy from "esbuild-plugin-copy";
import time from "esbuild-plugin-time";
import { createBareServer } from "@tomphttp/bare-server-node";
import Fastify from "fastify";
import { context } from "esbuild";
import { createServer } from "http"; 
import fastifyStatic from "@fastify/static";
import { join } from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const bare = createBareServer("/bare/", {
    logErrors: true
});

const fastify = Fastify({
    serverFactory: (handler, opts) => {
        return createServer()
            .on("request", (req, res) => {
                if (bare.shouldRoute(req)) {
                    bare.routeRequest(req, res);
                } else {
                    handler(req, res);
                }
            }).on("upgrade", (req, socket, head) => {
                if (bare.shouldRoute(req)) {
                    bare.routeUpgrade(req, socket, head);
                } else {
                    socket.end();
                }
            })
    }
});

fastify.register(fastifyStatic, {
    root: join(fileURLToPath(new URL(".", import.meta.url)), "./static"),
    decorateReply: false
});

//fastify.get("/", {
    
// })

fastify.listen({
    port: 1337
});

const devServer = await context({
    entryPoints: {
        client: "./src/client/index.ts",
        bundle: "./src/bundle/index.ts",
        worker: "./src/worker/index.ts",
        codecs: "./src/codecs/index.ts",
        bootstrapper: "./src/scramjet.bootstrapper.ts",
    },
    entryNames: "scramjet.[name]",
    outdir: "./dist",
    bundle: true,
    sourcemap: true,
    logLevel: "info",
    plugins: [
        copy({
            resolveFrom: "cwd",
            assets: [
                {
                    from: ["./node_modules/@mercuryworkshop/bare-mux/dist/bare.cjs"],
                    to: ["./static/bare-mux.js"],
                },
                {
                    from: ["./node_modules/@mercuryworkshop/bare-as-module3/dist/bare.cjs"],
                    to: ["./static/bare-client.js"],
                },
                {
                    from: ["./node_modules/@mercuryworkshop/libcurl-transport/dist/index.cjs"],
                    to: ["./static/curl-client.js"],
                },
                {
                    from: ["./node_modules/@mercuryworkshop/epoxy-transport/dist/index.js"],
                    to: ["./static/epoxy-client.js"],
                },
                {
                    from: ["./dist/*"],
                    to: ["./static"]
                },
            ],
        }),
        time()
    ],
});

await devServer.watch();
