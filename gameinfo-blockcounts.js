/**
 * Queries and caches block count information.
 *  - If no params supplied: all server block count info
 *  - If ?wid supplied: all world block count info
 *  - If ?pid supplied: all block count info for player
 *  - If ?wid&pid supplied: all world block count info for player
 * 
 * Block information is saved, and will only get fresh information
 * when the last query is:
 *  - no params: 2 hours old | NEW: 7 days old
 *  - ?wid: 1 hours old | NEW: 3 days old
 *  - ?pid: 30 mins old | NEW: 2 days old
 *  - ?pid&wid: 10 mins old | NEW 1 days old
 *
 * @param {!Object} req Cloud Function request context.
 * @param {!Object} res Cloud Function response context.
 */
exports.blockCounts = function blockCounts(req, res) {
    res.header('Content-Type','application/json');
    res.header('Access-Control-Allow-Origin', 'https://interflare.net');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    
    try {
        var wid = parseInt(req.param('wid'), 10) || 0;
        if (wid === NaN || wid === Infinity || wid > 999 || wid < 0) {
            return res.status(400).send('e: invalid wid format');
        }
        
        var pid = parseInt(req.param('pid'), 10) || 0;
        if (pid === NaN || pid === Infinity || pid > 9999 || pid < 0) {
            return res.status(400).send('e: invalid pid format');
        }

        // only try to connect after we at least have valid inputs
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

        // Create the query
        let dsQuery = datastore.createQuery('if.game', 'BlockCounts')
        let refresh_date = new Date();
        var key = datastore.key({
            namespace: 'if.game',
            path: [
                'BlockCounts',
                `${pid}-${wid}` // pid-wid, 0 if undefined
            ]
        });


        // anonymous inner-function to update data
        let refresh = () => {
            // refresh the stale data
            try {
                let conn_start = new Date();
                connection.connect();

                if (wid === 0 && pid === 0) {
                    // Entire server
                    var query = `SELECT
                        (SELECT COUNT(rowid) FROM \`creative\`.\`co_block\` WHERE \`action\` = 1 AND \`rolled_back\` = 0) as 'placed',
                        (SELECT COUNT(rowid) FROM \`creative\`.\`co_block\` WHERE \`action\` = 0 AND \`rolled_back\` = 0) as 'broken',
                        (SELECT COUNT(rowid) FROM \`creative\`.\`co_block\` WHERE \`rolled_back\` = 1) as 'rolledback'`;
                    
                    var params = [];
                } else if (wid !== 0 && pid === 0) {
                    // Specific world
                    var query = `SELECT
                        (SELECT COUNT(rowid) FROM \`creative\`.\`co_block\` WHERE \`action\` = 1 AND \`rolled_back\` = 0 AND \`wid\` = ?) as 'placed',
                        (SELECT COUNT(rowid) FROM \`creative\`.\`co_block\` WHERE \`action\` = 0 AND \`rolled_back\` = 0 AND \`wid\` = ?) as 'broken',
                        (SELECT COUNT(rowid) FROM \`creative\`.\`co_block\` WHERE \`rolled_back\` = 1 AND \`wid\` = ?) as 'rolledback'`;
                    
                    var params = [wid,wid,wid]; // I know, bad design
                } else if (wid === 0 && pid !== 0) {
                    // Player, all worlds
                    var query = `SELECT
                        (SELECT COUNT(rowid) FROM \`creative\`.\`co_block\` WHERE \`action\` = 1 AND \`rolled_back\` = 0 AND \`user\` = ?) as 'placed',
                        (SELECT COUNT(rowid) FROM \`creative\`.\`co_block\` WHERE \`action\` = 0 AND \`rolled_back\` = 0 AND \`user\` = ?) as 'broken',
                        (SELECT COUNT(rowid) FROM \`creative\`.\`co_block\` WHERE \`rolled_back\` = 1 AND \`user\` = ?) as 'rolledback'`;

                    var params = [pid,pid,pid];
                } else if (wid !== 0 && pid !== 0) {
                    // Player, specific world
                    var query = `SELECT
                        (SELECT COUNT(rowid) FROM \`creative\`.\`co_block\` WHERE \`action\` = 1 AND \`rolled_back\` = 0 AND \`wid\` = ? AND \`user\` = ?) as 'placed',
                        (SELECT COUNT(rowid) FROM \`creative\`.\`co_block\` WHERE \`action\` = 0 AND \`rolled_back\` = 0 AND \`wid\` = ? AND \`user\` = ?) as 'broken',
                        (SELECT COUNT(rowid) FROM \`creative\`.\`co_block\` WHERE \`rolled_back\` = 1 AND \`wid\` = ? AND \`user\` = ?) as 'rolledback'`;

                    var params = [wid,pid,wid,pid,wid,pid];
                }
                
                connection.query(query, params,
                    (err, results, fields) => {
                        if (err) throw err;

                        datastore.upsert({
                            key: key,
                            data: {
                                pid: pid,
                                wid: wid,
                                broken: results[0].broken,
                                placed: results[0].placed,
                                rolledback: results[0].rolledback,
                                time_taken: new Date() - conn_start,
                                timestamp: new Date()
                            }
                        }).then(() => {
                            return; //exit program
                        });
                    });
            } catch (ex2) {
                console.error(ex2);
                return res.status(500).send('e: server error (ex2)');
            } finally {
                connection.end();
            }
        };


        // Go through every possible combination of wid
        // and pid being 0 to specify cache ttl
        if (wid === 0 && pid === 0) {
            // Entire server
            refresh_date.setDate(refresh_date.getDate() - 7);
        } else if (wid !== 0 && pid === 0) {
            // Specific world
            refresh_date.setDate(refresh_date.getDate() - 3);
        } else if (wid === 0 && pid !== 0) {
            // Player, all worlds
            refresh_date.setDate(refresh_date.getDate() - 2);
        } else if (wid !== 0 && pid !== 0) {
            // Player, specific world
            refresh_date.setDate(refresh_date.getDate() - 1);
        }

        dsQuery.filter('__key__', '=', key);
        datastore.runQuery(dsQuery)
            .then(results => {
                if (results[0].length !== 0) {
                    // datastore hit
                    const count = results[0][0];

                    let result = {
                        pid: count.pid,
                        wid: count.wid,
                        data: {
                            broken: count.broken,
                            placed: count.placed,
                            rolledback: count.rolledback
                        },
                        cache: {
                            last_update: count.timestamp,
                            refreshed: false // are new results available after this req?
                        }
                    };

                    if (count.timestamp > refresh_date) {
                        // data is already fresh enough
                        return res.status(200).send(result);
                    } else {
                        // let the application know that the data will
                        // be updated after this request
                        result.cache.refreshed = true;
    
                        // terminate http req early, so the data can be
                        // refreshed without keeping user waiting
                        res.status(200).send(result);
                        return refresh();
                    }
                } else {
                    // datastore miss, player hasn't been looked up before
                    let result = {
                        pid: pid,
                        wid: wid,
                        data: {
                            broken: 0,
                            placed: 0,
                            rolledback: 0
                        },
                        cache: {
                            last_update: new Date(),
                            refreshed: true
                        }
                    };

                    res.status(200).send(result);
                    return refresh();
                }
            });
    } catch (ex1) {
        console.error(ex1);
        return res.status(500).send('e: server error (ex1)');
    }
};
