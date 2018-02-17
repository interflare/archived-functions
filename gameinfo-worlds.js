/**
 * Queries and caches the full world list. Refreshes hourly.
 *
 * @param {!Object} req Cloud Function request context.
 * @param {!Object} res Cloud Function response context.
 */
exports.worlds = function worlds(req, res) {
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

        try {
            let ds_query = datastore.createQuery('if.game', 'Worlds');
            datastore.runQuery(ds_query).then(results => {
                let data = { worlds: [], cache: { last_update: new Date(), refreshed: false } };
                let needs_refresh = false;
                let refresh_date = new Date();
                refresh_date.setHours(refresh_date.getHours() - 1);
                results[0].forEach(el => {
                    if (el.wid === 99999) {
                        if (el.timestamp < refresh_date) {
                            needs_refresh = true;
                            data.cache.refreshed = true;
                        }

                        data.cache.last_update = el.timestamp;
                    } else {
                        data.worlds.push(el);
                    }
                });

                // send the data through, refreshing in the bg if needed
                res.status(200).send(data);

                if (needs_refresh) {
                    try {
                        let conn_start = new Date();
                        connection.connect();
                        
                        var query = `SELECT \`id\`, \`world\` FROM \`creative\`.\`co_world\``;
                        connection.query(query, [], (err, results, fields) => {
                            if (err) throw err;
                            results.forEach(el => {
                                datastore.upsert({
                                    key: datastore.key({
                                        namespace: 'if.game',
                                        path: [ 'Worlds', el.id ]
                                    }),
                                    data: {
                                        wid: el.id,
                                        name: el.world
                                    }
                                });
                            });

                            datastore.upsert({
                                key: datastore.key({
                                    namespace: 'if.game',
                                    path: [ 'Worlds', 99999 ]
                                }),
                                data: {
                                    wid: 99999,
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
