
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Chat } from '@google/genai';
import { Message, Sender, SpeechRecognition, SpeechRecognitionEvent, SpeechRecognitionErrorEvent } from './types';
import { geminiService } from './services/geminiService';
import MicIcon from './components/MicIcon';
import StopIcon from './components/StopIcon';
import VolumeUpIcon from './components/VolumeUpIcon';
import LoadingSpinner from './components/LoadingSpinner';
import ChatMessageBubble from './components/ChatMessageBubble';

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition: SpeechRecognition | null = null;

if (SpeechRecognitionAPI) {
  recognition = new SpeechRecognitionAPI();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
}

const App: React.FC = () => {
  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const userTranscriptRef = useRef<string>('');
  const [isLoadingAI, setIsLoadingAI] = useState<boolean>(false);
  const [isAISpeaking, setIsAISpeaking] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [apiKeyMissing, setApiKeyMissing] = useState<boolean>(false);
  const [conversationStarted, setConversationStarted] = useState<boolean>(false); // New state

  const messagesEndRef = useRef<null | HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(scrollToBottom, [messages]);

  useEffect(() => {
    if (!process.env.API_KEY) {
      setError("Critical Error: API_KEY is not configured. The application cannot function.");
      setApiKeyMissing(true);
      setIsInitialized(false);
      return;
    }
    setApiKeyMissing(false);

    async function initializeChat() {
      try {
        const newChat = geminiService.createChatSession();
        setChat(newChat);

        const initialMessageText = "Hello! I'm your AI English practice partner. How are you doing today?";
        setMessages([{ id: Date.now().toString(), text: initialMessageText, sender: Sender.AI, timestamp: new Date() }]);
        // Do NOT speakText here automatically. User will initiate via button.
        setIsInitialized(true);
      } catch (e: any) {
        console.error("Initialization failed:", e);
        setError(`Initialization failed: ${e.message || 'Unknown error'}. Please ensure your API key is valid and check network connection.`);
        setIsInitialized(false);
      }
    }
    initializeChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); 

  const speakText = useCallback((text: string) => {
    if (!('speechSynthesis' in window)) {
      setError("Text-to-Speech not supported in this browser.");
      return;
    }
    if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.onstart = () => setIsAISpeaking(true);
    utterance.onend = () => setIsAISpeaking(false);
    utterance.onerror = (event) => {
      console.error("SpeechSynthesis Error:", event);
      setError(`Text-to-speech error: ${event.error}`);
      setIsAISpeaking(false);
    };
    speechSynthesis.speak(utterance);
  }, []);

  const handleStartConversation = useCallback(() => {
    if (messages.length > 0 && messages[0].sender === Sender.AI && !conversationStarted) {
      speakText(messages[0].text);
    }
    setConversationStarted(true);
    setError(null); // Clear any previous errors shown before starting
  }, [messages, speakText, conversationStarted]);


  const processAndSendTranscript = useCallback(async (transcript: string) => {
    const trimmedTranscript = transcript.trim();
    if (trimmedTranscript && chat) {
      setMessages(prev => [...prev, { id: Date.now().toString(), text: trimmedTranscript, sender: Sender.USER, timestamp: new Date() }]);
      
      setIsLoadingAI(true);
      try {
        const aiResponseText = await geminiService.getAIChatResponse(trimmedTranscript, chat);
        setMessages(prev => [...prev, { id: (Date.now()+1).toString(), text: aiResponseText, sender: Sender.AI, timestamp: new Date() }]);
        speakText(aiResponseText);
      } catch (e: any) {
        console.error("AI response error:", e);
        const errorMessage = `Error getting AI response: ${e.message || 'Unknown error'}`;
        setError(errorMessage);
        const fallbackMessage = "Sorry, I encountered an issue. Could you please try that again?";
        setMessages(prev => [...prev, { id: (Date.now()+1).toString(), text: fallbackMessage, sender: Sender.AI, timestamp: new Date() }]);
        speakText(fallbackMessage);
      } finally {
        setIsLoadingAI(false);
      }
    }
    userTranscriptRef.current = '';
    setInterimTranscript('');
  }, [chat, speakText]);


  useEffect(() => {
    if (!recognition || !isRecording) return;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let currentInterim = '';
      let currentFinal = userTranscriptRef.current;

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcriptPart = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          currentFinal += transcriptPart + ' ';
        } else {
          currentInterim += transcriptPart;
        }
      }
      userTranscriptRef.current = currentFinal;
      setInterimTranscript(currentInterim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('Speech recognition error:', event.error);
      if (event.error === 'no-speech') {
        setError("I didn't hear anything. Please try speaking again.");
      } else if (event.error === 'audio-capture') {
        setError("Audio capture error. Please check your microphone.");
      } else if (event.error === 'not-allowed') {
        setError("Microphone access was denied. Please enable microphone permissions in your browser settings.");
      } else {
        setError(`Speech recognition error: ${event.error}`);
      }
      setIsRecording(false);
      userTranscriptRef.current = '';
      setInterimTranscript('');
    };
    
    recognition.onend = () => {
        if (isRecording) { 
            setIsRecording(false); 
            processAndSendTranscript(userTranscriptRef.current);
        }
    };

  }, [isRecording, processAndSendTranscript]);


  const handleToggleRecording = useCallback(async () => {
    if (apiKeyMissing || !isInitialized || !recognition || !conversationStarted) {
      if (!recognition) setError("Speech recognition is not available in your browser.");
      if (!conversationStarted) setError("Please start the conversation first.");
      return;
    }

    if (isAISpeaking) { 
        speechSynthesis.cancel();
        setIsAISpeaking(false);
    }

    if (isRecording) { 
      recognition.stop(); 
      setIsRecording(false); 
    } else { 
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true }); 
        userTranscriptRef.current = ''; 
        setInterimTranscript('');
        recognition.start();
        setIsRecording(true);
        setError(null); 
      } catch (err: any) {
        console.error("Error starting recognition or getting mic permission:", err);
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            setError("Microphone access denied. Please enable microphone permissions in your browser settings.");
        } else {
            setError("Could not start recording. Please check microphone.");
        }
        setIsRecording(false);
      }
    }
  }, [isRecording, isAISpeaking, isInitialized, apiKeyMissing, conversationStarted, processAndSendTranscript]);

  if (apiKeyMissing) {
    return (
      <div className="flex items-center justify-center h-screen bg-red-100 text-red-700 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Configuration Error</h1>
          <p>{error}</p>
          <p className="mt-2 text-sm">Please contact the application administrator.</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col h-screen max-h-screen bg-gray-100 font-sans">
      <header className="bg-blue-600 text-white p-4 shadow-md">
        <h1 className="text-xl font-semibold text-center">AI English Speaking Practice</h1>
      </header>

      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 m-4 rounded shadow-md" role="alert">
          <p className="font-bold">Error</p>
          <p>{error}</p>
        </div>
      )}

      <main className="flex-grow p-4 overflow-y-auto space-y-4 bg-gray-200">
        {!isInitialized && !apiKeyMissing && (
             <div className="flex flex-col items-center justify-center h-full">
                <LoadingSpinner size="w-12 h-12" color="text-blue-500" />
                <p className="text-gray-600 mt-4">Initializing AI Partner...</p>
             </div>
        )}

        {isInitialized && messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}

        {isInitialized && !conversationStarted && messages.length > 0 && (
            <div className="flex flex-col items-center justify-center py-4 mt-2">
                <button
                onClick={handleStartConversation}
                disabled={isAISpeaking}
                className="px-6 py-3 bg-green-500 text-white font-semibold rounded-lg shadow-md hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-2 transition-colors duration-200 flex items-center disabled:opacity-50"
                aria-label="Start conversation and hear welcome message"
                >
                <VolumeUpIcon />
                <span className="ml-2">Tap to Hear Welcome & Start</span>
                </button>
                {!isAISpeaking && <p className="text-sm text-gray-600 mt-2">Click the button above to begin.</p>}
            </div>
        )}
        
        {isRecording && interimTranscript && (
          <div className="flex justify-end mb-4">
            <div className="bg-blue-100 text-blue-700 max-w-xs lg:max-w-md px-4 py-3 rounded-xl shadow-md italic">
              <p className="text-sm">{userTranscriptRef.current + interimTranscript}...</p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </main>

      <footer className="bg-white p-4 border-t border-gray-300 shadow- ऊपर">
        <div className="flex items-center justify-center space-x-4">
          <div className="w-10 h-10 flex items-center justify-center">
            {isLoadingAI && <LoadingSpinner size="w-6 h-6" color="text-blue-500" />}
            {isAISpeaking && !isLoadingAI && <VolumeUpIcon />}
          </div>

          <button
            onClick={handleToggleRecording}
            disabled={!isInitialized || isLoadingAI || apiKeyMissing || !conversationStarted || (isRecording && !interimTranscript && !userTranscriptRef.current) /* Disable stop if nothing is recorded yet */}
            className={`p-4 rounded-full text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 shadow-lg
                        ${isRecording ? 'bg-red-500 hover:bg-red-600 focus:ring-red-400 animate-pulse' : 'bg-blue-500 hover:bg-blue-600 focus:ring-blue-400'}
                        ${(!isInitialized || isLoadingAI || apiKeyMissing || !conversationStarted) ? 'opacity-50 cursor-not-allowed' : ''}`}
            aria-label={isRecording ? "Stop recording" : "Start recording"}
          >
            {isRecording ? <StopIcon /> : <MicIcon />}
          </button>
          <div className="w-10 h-10"></div> {/* Spacer */}
        </div>
        {isInitialized && conversationStarted && isRecording && !interimTranscript && !userTranscriptRef.current &&(
             <p className="text-center text-sm text-gray-500 mt-2">Listening...</p>
        )}
        {isInitialized && conversationStarted && isRecording && (userTranscriptRef.current || interimTranscript) && (
            <p className="text-center text-sm text-gray-500 mt-2 italic">
                {userTranscriptRef.current + interimTranscript}...
            </p>
        )}
         {!isInitialized && conversationStarted && !isRecording && (
            <p className="text-center text-sm text-gray-500 mt-2">
                Click the microphone to speak.
            </p>
        )}
      </footer>
    </div>
  );
};

export default App;
