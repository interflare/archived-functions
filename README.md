# archived-functions
Now-defunct google cloud functions for retrieving and caching game data.

### Info
These scripts were used in GCP's serverless functions service. I don't know if these were the most up-to-date versions of each script, as I didn't upload them to GitHub (there was no point, you couldn't deploy from git, and GCP doesn't support secrets in it's serverless functions offering). These were just from a backup. Should work though.

The point of this is to make game data from a minecraft server (on 'hiatus' now) more available to the web, for the purpose of gamification and stats, administration, as well as promotion.

All of the scripts have roughly the same purpose as web endpoints - display any information is has on-hand as quickly as possible (even if it's a little old), and refresh the cache in the background after the http request terminates.

It connects to a MySQL database and performs what is usually a long-running query in the background, so the user doesn't have to wait around for what should be trivial information to anyone not in-the-know. The length of the query can't be shortened with indexing or anything of the like, as each player can easily generate hundreds of thousands of records in a couple of days. With about two people playing, we generated about 4GB of records in a week. This is why I chose an 'eventual' data design. The data isn't really that mission-critical, so it's not a problem if people see something a little outdated.


#### gameinfo-blockcounts.js
It's in the filename - get the number of placed, removed, and rolled-back blocks from the game. Can be filtered to a single player, world, or both.

#### gameinfo-players.js
Returns a cursored list of players and their IDs. Easily paged.

#### gameinfo-worlds.js
Like the player list, but isn't cursored. There's no point, as there aren't as many worlds.