Sugar test project (3 NFTs)

Folder layout:
  test-collection-3/
    config.json          <- Candy Machine settings (mint price, supply, creator wallet)
    assets/
      0.png, 0.json
      1.png, 1.json
      2.png, 2.json
      collection.png, collection.json

Run Sugar from test-collection-3 (this folder), not from inside assets/.

Commands (devnet keypair configured):
  sugar validate
  sugar upload
  sugar deploy
  sugar mint
