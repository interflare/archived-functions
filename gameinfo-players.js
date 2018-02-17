/**
 * Queries and caches the player list. Refreshes every 15 minutes.
 *
 * @param {!Object} req Cloud Function request context.
 * @param {!Object} res Cloud Function response context.
 */
exports.players = function players(req, res) {
    res.header('Content-Type','application/json');
    res.header('Access-Control-Allow-Origin', 'https://interflare.net');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    
    try {
        const datastore = require('@google-cloud/datastore')({
            projectId: 'interflare-minecraft' // >>> defunct <<<
        });
    
        const mysql = require('mysql');
        const connection = mysql.createConnection({
            host: process.env.SQL_HOST, // connected to a read replica, not master db
            user: process.env.SQL_USER,
            password: process.env.SQL_PASS,
            database: process.env.SQL_DB
        });

        let cursor = req.param('cx') || false; // TODO: Set the cursor here from GET(cx)
        let limit = parseInt(req.param('lx'), 10) || 30;

        if (limit > 50) limit = 50; // nothing over 50 please
        if (limit === NaN || limit === Infinity) {
            return res.status(400).send('e: invalid lx format');
        }

        try {
            let ds_query = datastore.createQuery('if.game', 'Players')
                .limit(cursor ? limit : limit+1); // add one to the limit if no cursor, first page has 'meta' player
            if (cursor) ds_query = ds_query.start(cursor);
            datastore.runQuery(ds_query).then(results => {
                let players = results[0];
                let meta = results[1];

                let data = {};
                let needs_refresh = false;

                if (!cursor) {
                    // only check for refresh on non-paginated request
                    let refresh_date = new Date();
                    refresh_date.setMinutes(refresh_date.getMinutes() - 15);

                    if (players[0].timestamp < refresh_date) needs_refresh = true;

                    data['players'] = players.slice(1);
                    data['cache'] = {
                        last_update: players[0].timestamp,
                        refreshed: needs_refresh
                    };
                } else {
                    data['players'] = players;
                }

                if (meta.moreResults === datastore.NO_MORE_RESULTS) {
                    // end of results
                    data['cx'] = false;
                } else {
                    // but wait there's more!
                    data['cx'] = meta.endCursor;
                }

                // send the data through, refreshing in the bg if needed
                res.status(200).send(data);

                if (needs_refresh && !cursor) {
                    try {
                        let conn_start = new Date();
                        
                        let last_checked = Math.round(players[0].timestamp.getTime() / 1000);
                        var query = `SELECT * FROM \`creative\`.\`co_user\` WHERE \`uuid\` IS NOT NULL AND \`time\` > ?;`;
                        connection.query(query, [last_checked], (err, results, fields) => {
                            if (err) throw err;
                            results.forEach(el => {
                                datastore.upsert({
                                    key: datastore.key({
                                        namespace: 'if.game',
                                        path: [ 'Players', el.rowid ]
                                    }),
                                    data: {
                                        pid: el.rowid,
                                        uuid: el.uuid,
                                        name: el.user,
                                        joined: new Date(el.time * 1000), //unix timestamp -> datetime
                                        timestamp: new Date()
                                    }
                                });
                            });

                            // update the meta account
                            datastore.upsert({
                                key: datastore.key({
                                    namespace: 'if.game',
                                    path: [ 'Players', 1 ]
                                }),
                                data: {
                                    pid: 1,
                                    name: '_LASTUPDATE',
                                    time_taken: new Date() - conn_start,
                                    timestamp: new Date()
                                }
                            });
                        });
                    } catch (ex3) {
                        console.error(ex3);
                    } finally {
                        connection.end();
                    }
                } else return;
            });
        } catch (ex2) {
            return res.status(500).send('e: server error (ex2)');
        }
    } catch (ex1) {
        return res.status(500).send('e: server error (ex1)');
    }
};
