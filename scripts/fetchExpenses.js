/**
 * Used to fetch the budget data of the top 15 cities from all countries
 */

const geonames = require('geonames');
const path = require('path');
const pull = require('pull-stream');
const _ = require('underscore');
const fs = require('fs');

import request from 'request-promise-native';

pull(
  geonames.read(path.resolve(__dirname, '../data/cities15000.txt')),
  pull.filter(city => city.population >= 200000),
  pull.collect(async (err, cities) => {
      const citiesByCountry = _.groupBy(cities.sort((a, b) => b.population - a.population), it => it.country);
      let citiesToFetch = [];

      // Limit seleciton to top 15 cities
      for (const country in citiesByCountry) {
          citiesToFetch = citiesToFetch.concat(citiesByCountry[country].slice(0, 15));
      }

      console.log(`Found ${citiesToFetch.length} cities to fetch!`);
      console.log('Starting fetcher..');

      fetchCityRangeExpenses(citiesToFetch).then(data => fs.writeFile('citiesWithExpenses.json', JSON.stringify(data), () => {}));
  })
);

function sleep(ms){
    return new Promise(resolve=>{
        setTimeout(resolve,ms)
    })
}

async function fetchCityRangeExpenses(cities) {
    const citiesWithExpenses = [];

    for (const city of cities) {
        console.log(`Fetching ${city.name}...`);
        const expenses = await fetchCityExpenses(city);
        console.log(`...done with ${city.name} (${expenses !== null ? 'success' : 'error'})`);
        citiesWithExpenses.push(Object.assign(city, expenses));
        await sleep(1000);
    }

    return citiesWithExpenses;
}

async function fetchCityExpenses(city) {
    try {
        let body = await request(`https://www.budgetyourtrip.com/budgetreportadv.php?country_code=&startdate=&enddate=&categoryid=&budgettype=&triptype=&travelerno=&geonameid=${city.id}`);

        const currency = /var originalcur = "(.*)";/mg.exec(body)[1];
        const expenses = (body.match(/<li class="cost-tile (?!cost-tile-intro).[\s\S]*?<\/li>/mg) || []).map(raw => {
            // Probably not the most performant way to do it
            // but I dont want to come up with a gigantic regex that handles it.
            const label = /<div class="cost-tile-label">\s+([A-Za-z0-9 ]*)/mg.exec(raw)[1];
            let desc = /<span class="cost-tile-label-description">\s+([A-Za-z0-9 ]*)/mg.exec(raw);
            const value = /<span class="curvalue">(.*)<\/span>/mg.exec(raw)[1].replace(/,/g, '');

            if (desc !== null ) {
                desc = desc[1];
            }

            return {
                label,
                desc,
                value,
            };
        });

        const expenseLabels = expenses.map(e => e.label);

        // Fetch default data of country
        if (['Average Daily Cost', 'Accommodation'].some(label => expenseLabels.indexOf(label) === -1)) {
            return null;
        }

        return {
            currency,
            expenses
        };
    } catch (e) {
        // Fetch default data of country
        return null;
    }
}