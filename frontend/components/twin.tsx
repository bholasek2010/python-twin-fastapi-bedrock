'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Mic, Square, Volume2, VolumeX } from 'lucide-react';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    emotion?: string;
}

const EMOTIONS = [
    'sorry',
    'sad',
    'unhappy',
    'depressed',
    'lonely',
    'upset',
    'hurt',
    'worried',
    'concerned',
    'afraid',
    'scared',
    'anxious',
    'surprised',
    'shocked',
    'excited',
    'confused',
    'grateful',
    'friendly',
    'happy',
    'thoughtful',
    'curious',
    'neutral',
] as const;

function emotionIcon(emotion?: string) {
    const name = emotion && EMOTIONS.includes(emotion as (typeof EMOTIONS)[number])
        ? emotion
        : 'neutral';
    return `/favicons/${name}.svg`;
}

function classifyQuestionTone(text: string): string {
    const q = (text || '').trim().toLowerCase();
    if (!q) return 'neutral';
    const has = (...words: string[]) => words.some((word) => q.includes(word));

    if (has('sorry')) return 'sorry';
    if (has('depressed')) return 'depressed';
    if (has('lonely', 'miss you')) return 'lonely';
    if (has('unhappy')) return 'unhappy';
    if (has('upset')) return 'upset';
    if (has('hurt')) return 'hurt';
    if (has('sad')) return 'sad';
    if (has('afraid')) return 'afraid';
    if (has('scared')) return 'scared';
    if (has('anxious')) return 'anxious';
    if (has('worried')) return 'worried';
    if (has('concerned', 'risk', 'problem', 'wrong')) return 'concerned';
    if (has('shock', 'unbelievable')) return 'shocked';
    if (has('wow', 'whoa', 'no way')) return 'surprised';
    if (has('excited', "can't wait", 'amazing', 'awesome', 'love this', 'congrats')) return 'excited';
    if (has('confused', "don't understand", 'dont understand', 'unclear', 'lost me', 'huh')) return 'confused';
    if (has('thank', 'thanks', 'appreciate')) return 'grateful';
    if (has('nice to meet', 'hello', 'hey', 'how are you') || q === 'hi' || q.startsWith('hi ')) return 'friendly';
    if (has('happy', 'glad', 'great news', 'wonderful', 'smile')) return 'happy';
    if (has('think', 'thoughts', 'reflect', 'consider', 'opinion', 'should i', 'advice')) return 'thoughtful';
    if (has('why', 'how', 'what', 'when', 'where', 'who', 'curious') || q.endsWith('?')) return 'curious';
    return 'neutral';
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const MAX_RECORDING_SECONDS = 10;
const MAX_AUDIO_BYTES = 1_500_000;
const MAX_INPUT_CHARS = 100;

export default function Twin() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingSecondsLeft, setRecordingSecondsLeft] = useState(MAX_RECORDING_SECONDS);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [ttsEnabled, setTtsEnabled] = useState(true);
    const [sessionId, setSessionId] = useState<string>('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const audioBytesRef = useRef(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const ttsUrlRef = useRef<string | null>(null);
    const recordingTimerRef = useRef<number | null>(null);
    const recordingCountdownRef = useRef<number | null>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: "nearest", inline: "nearest" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        return () => {
            stopPlayback();
            clearRecordingTimers();
            mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        };
    }, []);

    const stopPlayback = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.src = '';
            audioRef.current = null;
        }
        if (ttsUrlRef.current) {
            URL.revokeObjectURL(ttsUrlRef.current);
            ttsUrlRef.current = null;
        }
    };

    const revealAssistantText = async (id: string, fullText: string) => {
        const chunks = fullText.split(/(\s+)/);
        let acc = '';
        for (const chunk of chunks) {
            acc += chunk;
            const shown = acc;
            setMessages((prev) =>
                prev.map((message) =>
                    message.id === id ? { ...message, content: shown } : message
                )
            );
            await new Promise((resolve) => setTimeout(resolve, 28));
        }
    };

    const playTts = async (text: string) => {
        if (!ttsEnabled || !text.trim()) return;
        stopPlayback();
        try {
            const response = await fetch(`${API_URL}/tts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text }),
            });
            if (!response.ok) throw new Error('TTS request failed');
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            ttsUrlRef.current = url;
            const audio = new Audio(url);
            audioRef.current = audio;
            await audio.play();
        } catch (error) {
            console.error('TTS error:', error);
        }
    };

    const sendMessage = async (text?: string) => {
        const content = (text ?? input).trim().slice(0, MAX_INPUT_CHARS);
        if (!content || isLoading || isRecording || isTranscribing) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content,
            timestamp: new Date(),
        };

        setMessages((prev) => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const response = await fetch(`${API_URL}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: userMessage.content,
                    session_id: sessionId || undefined,
                }),
            });

            if (!response.ok) throw new Error('Failed to send message');

            const data = await response.json();

            if (!sessionId) {
                setSessionId(data.session_id);
            }

            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: '',
                timestamp: new Date(),
                emotion: (EMOTIONS as readonly string[]).includes(data.emotion)
                    ? data.emotion
                    : classifyQuestionTone(content),
            };

            setMessages((prev) => [...prev, assistantMessage]);
            setIsLoading(false);
            void playTts(data.response);
            await revealAssistantText(assistantMessage.id, data.response);
        } catch (error) {
            console.error('Error:', error);
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'Sorry, I encountered an error. Please try again.',
                timestamp: new Date(),
                emotion: 'concerned',
            };
            setMessages((prev) => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
            setTimeout(() => {
                inputRef.current?.focus();
            }, 100);
        }
    };

    const transcribeAndSend = async (audioBlob: Blob) => {
        setIsTranscribing(true);
        try {
            const formData = new FormData();
            const extension = audioBlob.type.includes('mp4') ? 'mp4' : 'webm';
            formData.append('file', audioBlob, `recording.${extension}`);

            const response = await fetch(`${API_URL}/transcribe`, {
                method: 'POST',
                body: formData,
            });
            if (!response.ok) throw new Error('Transcription failed');

            const data = await response.json();
            const transcript = (data.text || '').trim().slice(0, MAX_INPUT_CHARS);
            if (!transcript) {
                throw new Error('No speech detected');
            }
            await sendMessage(transcript);
        } catch (error) {
            console.error('Transcription error:', error);
            const errorMessage: Message = {
                id: Date.now().toString(),
                role: 'assistant',
                content: 'Sorry, I could not transcribe that recording. Please try again.',
                timestamp: new Date(),
                emotion: 'concerned',
            };
            setMessages((prev) => [...prev, errorMessage]);
        } finally {
            setIsTranscribing(false);
        }
    };

    const clearRecordingTimers = () => {
        if (recordingTimerRef.current !== null) {
            window.clearTimeout(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }
        if (recordingCountdownRef.current !== null) {
            window.clearInterval(recordingCountdownRef.current);
            recordingCountdownRef.current = null;
        }
    };

    const stopRecording = () => {
        clearRecordingTimers();
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== 'inactive') {
            recorder.stop();
        }
        setIsRecording(false);
        setRecordingSecondsLeft(MAX_RECORDING_SECONDS);
    };

    const startRecording = async () => {
        if (isLoading || isTranscribing) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            const mimeType = MediaRecorder.isTypeSupported('audio/webm')
                ? 'audio/webm'
                : MediaRecorder.isTypeSupported('audio/mp4')
                  ? 'audio/mp4'
                  : '';
            const recorder = mimeType
                ? new MediaRecorder(stream, { mimeType })
                : new MediaRecorder(stream);
            audioChunksRef.current = [];
            audioBytesRef.current = 0;
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                    audioBytesRef.current += event.data.size;
                    if (audioBytesRef.current >= MAX_AUDIO_BYTES) {
                        stopRecording();
                    }
                }
            };
            recorder.onstop = async () => {
                clearRecordingTimers();
                stream.getTracks().forEach((track) => track.stop());
                mediaStreamRef.current = null;
                mediaRecorderRef.current = null;
                const blob = new Blob(audioChunksRef.current, {
                    type: recorder.mimeType || 'audio/webm',
                });
                audioChunksRef.current = [];
                audioBytesRef.current = 0;
                if (blob.size > 0) {
                    await transcribeAndSend(blob);
                }
            };
            mediaRecorderRef.current = recorder;
            recorder.start(250);
            setRecordingSecondsLeft(MAX_RECORDING_SECONDS);
            setIsRecording(true);
            recordingCountdownRef.current = window.setInterval(() => {
                setRecordingSecondsLeft((seconds) => Math.max(0, seconds - 1));
            }, 1000);
            recordingTimerRef.current = window.setTimeout(() => {
                stopRecording();
            }, MAX_RECORDING_SECONDS * 1000);
        } catch (error) {
            console.error('Microphone error:', error);
            setIsRecording(false);
            const errorMessage: Message = {
                id: Date.now().toString(),
                role: 'assistant',
                content: 'Microphone access is required to record a message.',
                timestamp: new Date(),
                emotion: 'concerned',
            };
            setMessages((prev) => [...prev, errorMessage]);
        }
    };

    const toggleRecording = () => {
        if (isRecording) {
            stopRecording();
        } else {
            void startRecording();
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void sendMessage();
        }
    };

    const [hasAvatar, setHasAvatar] = useState(false);
    useEffect(() => {
        fetch('/avatar.png', { method: 'HEAD' })
            .then(res => setHasAvatar(res.ok))
            .catch(() => setHasAvatar(false));
    }, []);

    return (
        <div className="flex flex-col h-full bg-gray-50 rounded-lg shadow-lg">
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-700 to-slate-800 text-white p-4 rounded-t-lg">
                <h2 className="text-md font-semibold flex items-center gap-2">
                    <Bot className="w-6 h-6" />
                    Conversational Twin
                    <button
                        type="button"
                        onClick={() => {
                            setTtsEnabled((enabled) => {
                                if (enabled) stopPlayback();
                                return !enabled;
                            });
                        }}
                        className="ml-auto p-1.5 rounded-md hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400"
                        title={ttsEnabled ? 'Mute spoken replies' : 'Unmute spoken replies'}
                        aria-label={ttsEnabled ? 'Mute spoken replies' : 'Unmute spoken replies'}
                    >
                        {ttsEnabled ? (
                            <Volume2 className="w-4 h-4" />
                        ) : (
                            <VolumeX className="w-4 h-4" />
                        )}
                    </button>
                </h2>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                    <div className="text-center text-gray-500 mt-8">
                        {hasAvatar ? (
                            <img 
                                src="./favicons/friendly.svg" 
                                alt="Digital Twin Avatar" 
                                className="w-20 h-20 rounded-full mx-auto mb-3"
                            />
                        ) : (
                            <Bot className="w-20 h-20 mx-auto mb-3 text-gray-400" />
                        )}
                        <p>Hello! I&apos;m a Conversational Twin.</p>
                        <p className="text-sm mt-2">Ask me anything about my background and experience!</p>
                    </div>
                )}

                {messages.map((message) => (
                    <div
                        key={message.id}
                        className={`flex gap-3 ${
                            message.role === 'user' ? 'justify-end' : 'justify-start'
                        }`}
                    >
                        {message.role === 'assistant' && (
                            <div className="flex-shrink-0">
                                <img
                                    src={emotionIcon(message.emotion)}
                                    alt={message.emotion || 'neutral'}
                                    title={message.emotion || 'neutral'}
                                    className="w-11 h-11 rounded-full bg-white border border-gray-300"
                                />
                            </div>
                        )}

                        <div
                            className={`max-w-[80%] rounded-lg p-3 ${
                                message.role === 'user'
                                    ? 'bg-slate-700 text-white'
                                    : 'bg-white border border-gray-200 text-gray-800'
                            }`}
                        >
                            <p className="whitespace-pre-wrap">{message.content}</p>
                            <p
                                className={`text-xs mt-1 ${
                                    message.role === 'user' ? 'text-slate-300' : 'text-gray-500'
                                }`}
                            >
                                {message.timestamp.toLocaleTimeString()}
                            </p>
                        </div>

                        {message.role === 'user' && (
                            <div className="flex-shrink-0">
                                <div className="w-10 h-10 bg-gray-600 rounded-full flex items-center justify-center">
                                    <User className="w-5 h-5 text-white" />
                                </div>
                            </div>
                        )}
                    </div>
                ))}

                {(isLoading || isTranscribing) && (
                    <div className="flex gap-3 justify-start">
                        <div className="flex-shrink-0">
                            <img
                                src={emotionIcon(isTranscribing ? 'thoughtful' : 'curious')}
                                alt={isTranscribing ? 'thoughtful' : 'curious'}
                                className="w-11 h-11 rounded-full bg-white border border-gray-300"
                            />
                        </div>
                        <div className="bg-white border border-gray-200 rounded-lg p-3">
                            <div className="flex space-x-2">
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-100" />
                                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-200" />
                            </div>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-gray-200 p-3 bg-white rounded-b-lg">
                <div className="flex gap-2">
                    <div className="relative flex-1">
                    <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_CHARS))}
                        onKeyDown={handleKeyPress}
                        maxLength={MAX_INPUT_CHARS}
                        placeholder={
                            isRecording
                                ? `Recording... ${recordingSecondsLeft}s left`
                                : isTranscribing
                                  ? 'Transcribing...'
                                  : `Type or tap the mic (${MAX_RECORDING_SECONDS}s max)...`
                        }
                        className="w-full px-4 py-2 pr-14 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-600 focus:border-transparent text-gray-800"
                        disabled={isLoading || isRecording || isTranscribing}
                        autoFocus
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                        {input.length}/{MAX_INPUT_CHARS}
                    </span>
                    </div>
                    <button
                        type="button"
                        onClick={toggleRecording}
                        disabled={isLoading || isTranscribing}
                        className={`px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                            isRecording
                                ? 'bg-red-600 text-white hover:bg-red-700'
                                : 'bg-slate-700 text-white hover:bg-slate-800'
                        }`}
                        title={
                            isRecording
                                ? `Stop recording (${recordingSecondsLeft}s left)`
                                : `Record a voice message (${MAX_RECORDING_SECONDS}s max)`
                        }
                        aria-label={
                            isRecording
                                ? `Stop recording, ${recordingSecondsLeft} seconds left`
                                : `Record a voice message, ${MAX_RECORDING_SECONDS} second maximum`
                        }
                    >
                        {isRecording ? (
                            <Square className="w-5 h-5" />
                        ) : (
                            <Mic className="w-5 h-5" />
                        )}
                    </button>
                    <button
                        onClick={() => void sendMessage()}
                        disabled={!input.trim() || isLoading || isRecording || isTranscribing}
                        className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Send className="w-5 h-5" />
                    </button>
                </div>
            </div>
        </div>
    );
}
