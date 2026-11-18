# Contributing

Bug reports and pull requests are welcome.

## Reporting a problem

Open an issue with:

- the exact input (for example `lever:metabase` or the careers-page URL);
- what you expected and what you got;
- the report row for that company, if there is one.

Please do not paste job descriptions that contain personal contact details.

## Changing the code

1. Use Node.js 20 or later. There are no dependencies to install.
2. Run `npm test`. Every test must pass, and none may use the network.
3. Add a test for the change. For an ATS field mapping, record a small real response under `test/fixtures/` and
   remove anything personal from it.
4. Keep the request limits in `src/http.js`: these endpoints serve real careers pages.

## Scope

The library reads the public job-board APIs of Greenhouse, Lever, Ashby and Workable. Changes that need a login, a
browser, a proxy or a way around a site's bot protection are out of scope.
