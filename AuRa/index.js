const express = require('express'); 
var parser = require('body-parser')
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const { Configuration, OpenAIApi } = require("openai");
require('dotenv').config();

const app = express();               
app.use(express.static(__dirname + '/img/'));
app.use(parser.urlencoded({ extended: true }));
app.use(parser.json());              

const accountSid = process.env.ACCOUNTSID;
const authToken = process.env.AUTHTOKEN;
const port = process.env.PORT;  
const client = require('twilio')(accountSid, authToken);

const CALL_END_WORDS = [
    'bye',
    'thank',
]

const HIGH_TEMPER_WORDS = [
    'shut up',
    'stressed',
    'I dont want to talk anymore',
    'fed up',
]

const configuration = new Configuration({
    apiKey: process.env.APIKEY,
  });
  
const openai = new OpenAIApi(configuration);
const history = [
    {"role": "system", "content": "You are a helpful assistant to calm down an angry person with short answers and only one response for every question"},
    {"role": "assistant", content: "console me for being angry without talking about anger in 2 lines" }
];


// Function to forward call
const callForward = async (voiceResponse) => {
    try {
        await voiceResponse.say({
            voice: 'Polly.Raveena'
        }, 
        textMiddleware('Please calm down, let me connect you to one of your friend'));
        voiceResponse.dial(process.env.FORWARDPHONE, {
            action: '/goodbye'
        });
    } catch(err) {
        console.log(err);
    }
};


// Function to get response from chatgpt
const getAnswer = async (query, tokens=150, addToHistory=true) => {
    // Send request
    const response =  await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        max_tokens: tokens,
        messages: query,
    });
    const completion_text = response.data.choices[0].message.content.replace(/^\w+:\s*/i, "").trim();;
    // console.log(completion_text);

    if (addToHistory)
        history.push({"role": "assistant", "content": completion_text});
    return completion_text;
};


// Function to get prompt from user in speech format
const collectUserPrompt = async (gatherPrompt, voiceResponse, addToHistory=true) => {
    console.log('inside collect user prompt');

    if (addToHistory)
        history.push({"role": "assistant", "content": gatherPrompt})
    const gather = voiceResponse.gather({
        speechTimeout: 'auto',
        speechModel: 'experimental_conversations',
        input: 'speech',
        action: '/respond',
        method: 'POST'
    });
    await gather.say({
        voice: 'Polly.Raveena',
    }, gatherPrompt);
};


// Function to modify text before converting to speech
const textMiddleware = text => {
    return text;
}


// API endpoint for home-screen
app.get('/', (req, res) => {  
    res.sendFile(__dirname + "/index.html");
});


// API endpoint for responding to succesive prompts from user
app.post('/respond', async (req, res) => { 
    const speechResult = req.body.SpeechResult;
    const voiceResponse = new VoiceResponse();
    history.push({"role": "user", "content": speechResult})

    if (CALL_END_WORDS.some(str => speechResult.includes(str))) {
        await voiceResponse.say({
                voice: 'Polly.Raveena'
            }, 
            textMiddleware('It was nice talking to you, take care, bye')
        );
        console.log('history =>', history);
    } else if (HIGH_TEMPER_WORDS.some(str => speechResult.includes(str))) {
        console.log('forwarding call');
        await callForward(voiceResponse);
    } else {
        answer = await getAnswer(history, 80);
        await voiceResponse.say({
                voice: 'Polly.Raveena'
            }, 
            textMiddleware(answer)
        );
        // Conditions after first response
    
        if (answer.includes("?")) {
            collectUserPrompt("", voiceResponse, false);
        } else {
            const followUp = await getAnswer([...history, {"role": "assistant", "content": "create a follow up question based on above conversation in a chill language"}], 80, false);
            collectUserPrompt(followUp, voiceResponse, true);
        }
    }
    // Render the response as XML in reply to the webhook request
    res.type('text/xml');
    res.send(voiceResponse.toString());
});


// Main endpoint where the call is redirected once-connected
app.post('/voice', async (req, res) => {  
    // console.log('inside voice history => ', history);      
    try { 
        const voiceResponse = new VoiceResponse();
        if (history.length === 2) {
            const answer = await getAnswer(history);
            await voiceResponse.say({
                    voice: 'Polly.Raveena',
                },
                textMiddleware(answer)
            );  
        } 
        
        collectUserPrompt('Tell me what happened ?', voiceResponse, true)
        res.type('text/xml');
        res.send(voiceResponse.toString());
      } catch (error) { 
        console.log(error);
      }
});


// Endpoint to trigger a call to target number
app.get("/call", (req, res) => {
    client.calls
      .create({
         url: 'https://8dc1-122-171-20-190.in.ngrok.io/voice',
         to: process.env.TOPHONE,
         from: process.env.FROMPHONE
       })
      .then(call => console.log(call.status));
});


// Endpoint to test the forward functionality
app.post("/forward", async (req, res) => {
    try {
        const twilio = new VoiceResponse();
        await twilio.say({
            voice: 'Polly.Raveena'
        }, 
        textMiddleware('Please calm down, let me connect you to one of your friend'));
        twilio.dial('', {
            action: '/goodbye'
        });
        res.set('Content-Type', 'text/xml');
        return res.send(twilio.toString());
    } catch(err) {
        console.log(err);
    }
});


// Dummy endpoint for forwarded call
app.get("/goodbye", (req, res) => {

});

app.listen(port, () => {
    console.log(`Now listening on port ${port}`); 
});