# Cities by budget

[![asciicast](https://asciinema.org/a/253189.png)](https://asciinema.org/a/253189)

This CLI tool finds global cities whose expenses (including flight, accommodation and daily expenses) match a given budget.

## How does it work?

The accommodation and average daily expenses of around 1.000 cities were fetched from [BudgetYourTrip.com](https://www.budgetyourtrip.com).

After some filtering, the flight expenses are fetched from [Kiwi.com](https://www.kiwi.com) and cached quite aggressively in order to avoid a lot of api requests.


## How to use?

```javascript
git clone https://github.com/StefanNemeth/cities-by-budget.git
cd cities-by-budget
npm install
npm run find
```

Just enter an airport of departure and a budget (currency is currently set to Euro) to retrieve recommended places of destination.

## TODO

- [ ] Improve caching of flights
- [ ] Fetch live accommodation using an external API
- [ ] Make flight date and currency configurable
