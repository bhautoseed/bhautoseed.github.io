
async function startSeeding(link,apikey){
  document.getElementById('status').innerHTML = "Status: In progress..."
  success = await seed(link,apikey) //Main function that does things
  if(success){
    document.getElementById('status').innerHTML = "Status: Complete!"
    alert("Seeding complete!")
  }else{
    document.getElementById('status').innerHTML = "Status: Error"
  }
}

async function seed(link,apikey){
    gamemode = document.querySelector('input[name="gamemode"]:checked').value
    output = document.querySelector('input[name="output"]:checked').value

    //If the start of the link doesnt match, end here
    //Uses regexp.test()
    if(!/^https:\/\/www.start.gg\/tournament\//.test(link)){
        alert(`Link doesn't match, use the format:\nhttps://www.start.gg/tournament/_/event/_`)
        return false
    }
    //converts link into start.gg slug and checks the link and apikey for errors
    //read getNumEntrants() comments for more info on error checking
    numEntrants = await verifyTournamentLink(link.substring(21),apikey,output)
    if(numEntrants == null){
        return false
    }

    //Gets the phaseId of the seeding for later use
    phaseId = await getPhaseId(link.substring(21),apikey)
    if(phaseId == null){
      alert("Error occurred when getting phase ID (no entrants?)")
      return false
    }

    const perPage = 150

    playerPR = []
    //Loops through every player in the event an finds their brawlhalla pr
    for(i = 1 ; (i-1)*perPage < numEntrants ; i++){
        const data = await getIDList(link.substring(21), i, apikey)
        if(data == null){
            alert(`Unknown start.gg api error: 1`)
            return false
        }
        try{
            for(j = 0 ; j < data.event.entrants.nodes.length ; j++){
                document.getElementById('status').innerHTML = `Status: In progress... ${j+1 + (i-1)*perPage}/${numEntrants}`
                const obj = data.event.entrants.nodes[j]
                //Get 1v1 pr of start.gg user
                if(gamemode == 1){
                    let pr = await queryPlayer(obj.participants[0].player.id, 1)
                    if(pr.error != null || pr.pr.powerRanking == 0){pr = 10000} //No pr found
                    else{pr = pr.pr.powerRanking} //pr found
                    playerPR.push({
                        seedId: obj.seeds[0].id,
                        pr: pr,
                        name:obj.name
                    })
                }
                //Get 2v2 pr of start.gg users and adds them for a total pr
                else{
                    let pr = await queryPlayer(obj.participants[0].player.id, 2)
                    if(pr.error != null || pr.pr.powerRanking == 0){pr = 10000} //No pr found
                    else{pr = pr.pr.powerRanking} //pr found
                    let pr2 = await queryPlayer(obj.participants[1].player.id, 2)
                    if(pr2.error != null || pr2.pr.powerRanking == 0){pr2 = 10000} //No pr found
                    else{pr2 = pr2.pr.powerRanking} //pr found
                    playerPR.push({
                        seedId: obj.seeds[0].id,
                        pr: pr+pr2,
                        name:obj.name
                    })
                }
            }
        }catch(error){
            alert(`Unknown error occurred: 2\nMost probable cause is incorrect gamemode selection`)
            console.log(error)
            return false
        }
    }


    playerPR.sort((a, b) => a.pr - b.pr);
    const seedMapping = playerPR.map((obj, index) => ({
      seedId: obj.seedId,
      seedNum: index+1,
    }))

    if(output == 2){ //If the desired output is to seed the tournament, this is where that happens
      result = await doSeeding(phaseId, seedMapping, apikey) 
      return true
    }else{ //Otherwise, convert the output to a csv and send it to the user
      csvString = "SeedNum,SeedID,Name\n"
      for(i = 0 ; i < playerPR.length ; i++){
        csvString+=`${i+1},${playerPR[i].seedId},${playerPR[i].name}\n`
      }
      let csvBlob = new Blob([csvString], { type: 'text/csv' });
      // Create a temporary anchor element
      var tempLink = document.createElement('a');

      // Create a URL for the Blob
      var url = URL.createObjectURL(csvBlob);

      // Set the href attribute to the Blob URL
      tempLink.href = url;

      // Set the download attribute with the desired filename
      tempLink.download = 'output.csv';

      // Append the anchor element to the body
      document.body.appendChild(tempLink);

      // Trigger a click on the anchor element
      tempLink.click();

      // Remove the temporary anchor element from the DOM
      document.body.removeChild(tempLink);

      // Revoke the Blob URL to free up resources
      URL.revokeObjectURL(url);
      return true
    }
}

//Queries the brawlhalla esports api for a specific start.gg player
//https://www.docs.brawltools.com/get/player/pr
async function queryPlayer(player, gamemode) {
  return await fetch(`https://api.brawltools.com/v1/player/pr?entrantSmashIds=${player}&gameMode=${gamemode}`)
  .then(r => { return r.json() }).catch(err => console.log(err));
}

//Gets the number of entrants in a tournament for future use
//Additionally checks to make sure apikey and tournament link are valid
async function verifyTournamentLink(slug, apikey, output) {
    query = `query EventQuery ($slug: String){
        event(slug: $slug){
          numEntrants
          tournament{
            admins{
              id
            }
          }
        }
      }`;
    variables = {
      "slug": slug
    }
    
    data = await queryAPI(query, variables, apikey)

    //apikey check
    if(data.message == "Invalid authentication token"){
        alert("Invalid apikey")
        return null
    }
    //If an error I didnt forsee happened
    if(data.data == null){
        alert("Unknown error occurred")
        return null
    }
    //tournament link check
    if(data.data.event == null){
        alert("Link doesn't match, use the format:\nhttps://www.start.gg/tournament/_/event/_")
        return null
    }
    //user admin check: gives an error if the apikey doesnt have permissions to seed the event
    if(output == 2 && (data.data.event.tournament == null || data.data.event.tournament.admins == null)){
        alert("Your APIKEY doesn't have permissions to seed the event\nMake sure your account is an admin in the tournament")
        return null
    }
    
    return data.data.event.numEntrants;
}

//Looks for the phaseId of the seeding
async function getPhaseId(slug,apikey){
  query = `query EventQuery ($slug: String){
      event(slug: $slug){
        entrants(query:{perPage:1}){
          nodes{
            seeds{
              phase{
                id
              }
            }
          }
        }
      }
    }`;
  variables = {
    "slug": slug
  }

  data = await queryAPI(query, variables, apikey)
  try{
    return data.data.event.entrants.nodes[0].seeds[0].phase.id
  }catch(error){
    console.log(error)
    return null
  }
}

//Gets a list of player IDs and their associated seed IDs
async function getIDList(slug, page, apikey) {
    query = `query EventQuery ($slug: String, $page:Int){
      event(slug: $slug){
        entrants(query:{perPage:150,page:$page}){
          nodes{
            name
            seeds{
              id
            }
            participants{
              player{
                id
              }
            }
          }
        }
      }
    }`;
    variables = {
      "slug": slug,
      "page": page
    }
    
    data = await queryAPI(query, variables, apikey)
    return data.data;
}

//Queries the start.gg API with a given query, variables, and api key
//Returns json output. 
//Read more at https://developer.start.gg/docs/intro
async function queryAPI(query, variables, apikey) {
    return await fetch('https://api.smash.gg/gql/alpha', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + `${apikey}`
      },
      body: JSON.stringify({
        query,
        variables: variables,
      })
    }).then(r => { return r.json() }).catch(err => alert(err));
}

//Takes the calculated seedMapping and seeds the event
async function doSeeding(phaseId, seedMapping, apikey){
  query = `mutation UpdatePhaseSeeding ($phaseId: ID!, $seedMapping: [UpdatePhaseSeedInfo]!) {
      updatePhaseSeeding (phaseId: $phaseId, seedMapping: $seedMapping) {
        id
      }
    }`;
  variables = {
    "phaseId": phaseId,
    "seedMapping": seedMapping
  }

  data = await queryAPI(query, variables, apikey)
  return data.data;
}